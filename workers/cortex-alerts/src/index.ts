import { z } from 'zod';
import { generateObject, models } from '@mycortex/ai-core';
import { createDb, type Db } from '@mycortex/db';
import type {
  AlertLevel,
  NodeRow,
  SmartAlertInsert,
} from '@mycortex/db/types';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  /** Look-back window for unprocessed nodes. Defaults to 90 min (covers 30-min
   *  cron + buffer for retries). */
  ALERTS_LOOKBACK_MINUTES: z.coerce.number().int().positive().default(90),
  /** Cap items per workspace per run. Avoids runaway after big ingestion bursts. */
  ALERTS_MAX_PER_WORKSPACE: z.coerce.number().int().positive().default(40),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

const ALERTS_SYSTEM_PROMPT = `Sos CORTEX, asistente personal del usuario. Tu trabajo AHORA es escanear contenido NUEVO (mails, docs, eventos, notas) y detectar qué demanda atención urgente.

Para CADA item recibido, decidí:

1. ¿Es accionable y urgente?
   - SÍ → asigná un level y armá la alerta
   - NO → omitilo del output (no devuelvas nada para items irrelevantes)

2. Si es accionable, asigná **level**:
   - **critical**: Hay que actuar HOY o se pierde algo (deadline en <24h, conductor sin asignar para viaje mañana, factura pendiente, urgencia médica/legal).
   - **high**: Hay que actuar esta semana (próxima reunión que requiere prep, mail importante esperando respuesta, documentación pendiente con deadline cercano).
   - **low**: FYI relevante pero sin urgencia (newsletter con dato útil, evento informativo, cambio menor).

3. Generá **title** (1 línea, ≤70 chars): el qué.
   - Bien: "Datafast: contrato listo para firmar"
   - Mal: "Hay correspondencia con Datafast"

4. Generá **action** (1-2 oraciones, ≤200 chars): el qué hacer concreto.
   - Bien: "Entrar al portal SENADI, ir a Acciones, confirmar para iniciar registro de marca."
   - Mal: "Revisar el mail de SENADI."

5. Extraé **deadline** si se menciona fecha/hora explícita o implícita en el item.
   - Formato ISO 8601: "2026-05-14T07:00:00Z"
   - Si no hay deadline claro, null.

6. **context** (≤120 chars): snippet textual del item para contexto.

REGLAS:
- Sé conservador con "critical" — solo cosas REALMENTE inmediatas (≤24h).
- Newsletters, marketing, notificaciones automáticas, social → casi siempre se omiten.
- Si el item es ambiguo (no está claro si demanda acción), preferí OMITIRLO.
- Match el idioma del contenido (probablemente español).
- Salida: array JSON de objetos {nodeId, level, title, action, deadline, context}. SOLO los items accionables. Items omitidos = no aparecen en el array.`;

const AlertItemSchema = z.object({
  nodeId: z.string().uuid(),
  level: z.enum(['critical', 'high', 'low']),
  title: z.string().min(1).max(120),
  action: z.string().min(1).max(300),
  deadline: z.string().datetime().nullable(),
  context: z.string().max(200).nullable(),
});

const AlertsResponseSchema = z.object({
  alerts: z.array(AlertItemSchema),
});

/**
 * Render a node into a compact line for the LLM input. Includes the
 * node's UUID so the LLM can reference it back in its output.
 */
function nodeLine(n: NodeRow): string {
  const meta = (n.external_metadata ?? {}) as Record<string, unknown>;
  const date = (meta.date as string | undefined) ?? n.created_at;
  const title = n.title ?? '(sin título)';
  if (n.external_source === 'gmail') {
    const from = (meta.from as string | undefined) ?? '';
    const fromShort = from.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim() ?? from;
    return `[Gmail] nodeId="${n.id}" date="${date}" from="${fromShort.slice(0, 40)}"\nSubject: ${title}\n${n.content.slice(0, 400).replace(/\s+/g, ' ')}`;
  }
  if (n.external_source === 'drive') {
    const filename = (meta.filename as string | undefined) ?? title;
    return `[Drive] nodeId="${n.id}" date="${date}" file="${filename}"\n${n.content.slice(0, 400).replace(/\s+/g, ' ')}`;
  }
  if (n.external_source === 'calendar') {
    const start = (meta.start as string | undefined) ?? '';
    return `[Calendar] nodeId="${n.id}" start="${start}" title="${title}"\n${n.content.slice(0, 400).replace(/\s+/g, ' ')}`;
  }
  return `[Nota] nodeId="${n.id}" date="${date}" title="${title}"\n${n.content.slice(0, 400).replace(/\s+/g, ' ')}`;
}

async function alertsForWorkspace(
  db: Db,
  workspaceId: string,
  cfg: z.infer<typeof EnvSchema>,
): Promise<{ scanned: number; created: number; skipped: number; errors: string[] }> {
  const stats = { scanned: 0, created: 0, skipped: 0, errors: [] as string[] };

  // Owner_id needed to attribute the alert (alerts.user_id NOT NULL).
  const { data: ws } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws) return stats;

  const since = new Date(Date.now() - cfg.ALERTS_LOOKBACK_MINUTES * 60_000).toISOString();

  // Fetch recent nodes in this workspace.
  const { data: nodes, error } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(cfg.ALERTS_MAX_PER_WORKSPACE);
  if (error || !nodes || nodes.length === 0) {
    return stats;
  }

  // Filter out nodes that already have an alert (idempotency).
  const nodeIds = nodes.map((n) => n.id);
  const { data: existingAlerts } = await db
    .from('smart_alerts')
    .select('node_id')
    .eq('workspace_id', workspaceId)
    .in('node_id', nodeIds);
  const alreadyClassified = new Set(
    (existingAlerts ?? []).map((a) => a.node_id),
  );
  const newNodes = nodes.filter((n) => !alreadyClassified.has(n.id));
  stats.scanned = newNodes.length;
  if (newNodes.length === 0) return stats;

  // Build the LLM input.
  const prompt =
    `Escaneá los siguientes ${newNodes.length} items nuevos. Devolvé el array "alerts" con SOLO los accionables.\n\n` +
    newNodes.map((n) => `===\n${nodeLine(n)}`).join('\n');

  let response: z.infer<typeof AlertsResponseSchema>;
  try {
    const result = await generateObject({
      model: models.classifier, // GPT-4o-mini — fast, cheap, JSON-mode.
      schema: AlertsResponseSchema,
      system: ALERTS_SYSTEM_PROMPT,
      prompt,
      maxTokens: 4000,
    });
    response = result.object;
  } catch (err) {
    stats.errors.push(`llm:${String(err).slice(0, 200)}`);
    return stats;
  }

  if (response.alerts.length === 0) {
    return stats;
  }

  // Sanity-check the LLM didn't hallucinate node ids that aren't in the
  // batch we sent. Only keep alerts referencing real nodes from this run.
  const validNodeIds = new Set(newNodes.map((n) => n.id));
  const toInsert: SmartAlertInsert[] = [];
  for (const alert of response.alerts) {
    if (!validNodeIds.has(alert.nodeId)) {
      stats.errors.push(`hallucinated_nodeId:${alert.nodeId.slice(0, 8)}`);
      continue;
    }
    toInsert.push({
      workspace_id: workspaceId,
      user_id: ws.owner_id,
      node_id: alert.nodeId,
      level: alert.level as AlertLevel,
      title: alert.title,
      action: alert.action,
      deadline: alert.deadline,
      context: alert.context,
    });
  }

  if (toInsert.length === 0) {
    return stats;
  }

  // Use upsert with the unique (workspace_id, node_id) constraint to
  // protect against races (e.g. two parallel runs hitting the same nodes).
  const { error: insErr } = await db
    .from('smart_alerts')
    .upsert(toInsert, { onConflict: 'workspace_id,node_id', ignoreDuplicates: true });
  if (insErr) {
    stats.errors.push(`db:${insErr.message.slice(0, 200)}`);
    return stats;
  }
  stats.created = toInsert.length;
  stats.skipped = response.alerts.length - toInsert.length;
  return stats;
}

async function main(): Promise<void> {
  const env = EnvSchema.safeParse(process.env);
  if (!env.success) {
    log('error', 'invalid_env', { issues: env.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = env.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'alerts_start', { lookbackMin: cfg.ALERTS_LOOKBACK_MINUTES });
  const started = Date.now();

  const { data: workspaces, error } = await db.from('workspaces').select('id');
  if (error) {
    log('error', 'list_workspaces_failed', { error: error.message });
    process.exit(1);
  }
  if (!workspaces || workspaces.length === 0) {
    log('info', 'no_workspaces');
    return;
  }

  const totals = { scanned: 0, created: 0, skipped: 0 };
  const errors: string[] = [];
  let processed = 0;
  let withAlerts = 0;

  for (const ws of workspaces) {
    const stats = await alertsForWorkspace(db, ws.id, cfg);
    if (stats.scanned > 0) processed++;
    if (stats.created > 0) withAlerts++;
    totals.scanned += stats.scanned;
    totals.created += stats.created;
    totals.skipped += stats.skipped;
    errors.push(...stats.errors.slice(0, 3));
  }

  log('info', 'alerts_done', {
    elapsedMs: Date.now() - started,
    workspaces: workspaces.length,
    processed_with_new_content: processed,
    workspaces_with_new_alerts: withAlerts,
    ...totals,
    sampleErrors: errors.slice(0, 5),
  });
}

main().catch((err) => {
  log('error', 'alerts_crashed', { error: String(err) });
  process.exit(1);
});
