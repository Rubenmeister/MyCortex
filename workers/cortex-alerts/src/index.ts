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
  /**
   * Antigüedad máxima del CONTENIDO (no de la ingesta). ALERTS_LOOKBACK_MINUTES
   * mira `nodes.created_at`, que es cuándo lo guardamos — no cuándo pasó. Un
   * backfill de Gmail trae meses de bandeja con created_at = ahora, y sin este
   * tope el motor los trata como novedad: el 16-jul alertó un correo del 5-may.
   */
  ALERTS_MAX_CONTENT_AGE_DAYS: z.coerce.number().int().positive().default(7),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

const ALERTS_SYSTEM_PROMPT = `Eres CORTEX, asistente personal del usuario. Tu trabajo AHORA es escanear contenido NUEVO (mails, docs, eventos, notas) y detectar qué demanda atención urgente.

Para CADA item recibido, decide:

1. ¿Es accionable y urgente?
   - SÍ → asigna un level y arma la alerta
   - NO → omítelo del output (no devuelvas nada para items irrelevantes)

2. Si es accionable, asigna **level**:
   - **critical**: Hay que actuar HOY o se pierde algo (deadline en <24h, conductor sin asignar para viaje mañana, urgencia médica/legal, suspensión de servicio inminente).
   - **high**: Hay que actuar esta semana (próxima reunión que requiere prep, mail importante esperando respuesta, documentación pendiente con deadline cercano, contrato pendiente de firma).
   - **low**: FYI relevante pero sin urgencia (cambio de política, evento informativo, dato útil que vale la pena recordar).

3. Genera **title** (1 línea, ≤70 chars): el qué.
   - Bien: "Datafast: contrato listo para firmar"
   - Mal: "Hay correspondencia con Datafast"

4. Genera **action** (1-2 oraciones, ≤200 chars): el qué hacer concreto.
   - Bien: "Entrar al portal SENADI, ir a Acciones, confirmar para iniciar registro de marca."
   - Mal: "Revisar el mail de SENADI."

5. Extrae **deadline** si se menciona fecha/hora explícita o implícita en el item.
   - Formato ISO 8601: "2026-05-14T07:00:00Z"
   - Si no hay deadline claro, null.

6. **context** (≤120 chars): snippet textual del item para contexto.

REGLAS DE OMISIÓN (estos NUNCA generan alerta, devuélvelos vacíos):
- **OTPs / códigos de seguridad de un solo uso**: cualquier mail con código numérico de 4-8 dígitos que expira en minutos (códigos de login, 2FA, verificación de SMS bancarios, "clave de seguridad temporal", "código de verificación"). Para cuando el usuario los vea ya expiraron. OMITIR SIEMPRE, sin importar el banco/servicio.
- **Newsletters, marketing, promociones**: ofertas, descuentos, "no te pierdas", catálogos, blog posts auto-enviados.
- **Notificaciones de redes sociales**: likes, comments, menciones, "alguien comentó tu post".
- **Confirmaciones de transacciones ya completadas**: "tu pago fue exitoso", "recibimos tu transferencia". Solo informativos.
- **Status normales de sistemas**: "tu app funciona normal", reportes de uptime, "todo OK".
- **Automatización de desarrollo**: notificaciones de GitHub/Vercel/CI/CD, builds, deploys, pull requests, errores de Sentry, dependabot. El usuario ya vive en esas herramientas; esto es un asistente PERSONAL, no un panel de ops. OMITIR SIEMPRE, aunque digan "failure" o "urgente".
- **Reportes automáticos que el propio usuario o sus agentes generan** (health reports, briefings diarios, resúmenes): son informativos, no acciones pendientes.
- **Recibos / facturas ya pagadas / cierres de cuenta sin acción pendiente**.

REGLAS DE INCLUSIÓN (estos SÍ son alerta accionable):
- Documentación pendiente con deadline (firma de contrato, completar trámite, subir archivo).
- Mensajes de personas reales esperando respuesta concreta.
- Cuentas bloqueadas, accesos comprometidos, alertas de seguridad QUE REQUIEREN ACCIÓN (cambiar contraseña, contactar soporte) — NO los OTPs.
- Reuniones próximas que requieren preparación.
- Tareas asignadas en plataformas de NEGOCIO (Datafast, Datil, SRI, bancos, portales de trámites). NO herramientas de desarrollo — esas están en la lista de omisión.
- Operaciones logísticas inminentes sin asignar (viajes, entregas).

REGLAS GENERALES:
- Sé conservador con "critical" — solo cosas REALMENTE inmediatas (≤24h).
- Si el item es ambiguo (no está claro si demanda acción), prefiere OMITIRLO.
- Escribe en el IDIOMA del contenido (probablemente español), pero NUNCA en su dialecto: aunque el correo use voseo (entrá, tenés, hacé), tú siempre escribes español neutro de Ecuador con "tú". El registro es tuyo, no del remitente.
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
 * Remitentes que son máquinas avisando de máquinas: GitHub/Vercel/CI, deploys,
 * Sentry. Tras sacar los commits del bridge, el MISMO ruido volvió por Gmail
 * ("Revisar implementación de Sentry en la API", de `vercel[bot]`, marcada
 * high). Se corta por remitente — un dato duro — en vez de pedirle criterio al
 * modelo. Deliberadamente estrecho: `no-reply@` en general NO entra aquí, que
 * ahí viven facturas y avisos del banco que sí importan.
 */
const BOT_SENDER = /notifications@github\.com|\[bot\]|noreply@(vercel|netlify|github)\.com|@sentry\.io/i;

function isBotSender(n: NodeRow): boolean {
  if (n.external_source !== 'gmail') return false;
  const from = ((n.external_metadata ?? {}) as Record<string, unknown>).from;
  return typeof from === 'string' && BOT_SENDER.test(from);
}

/**
 * Fecha propia del contenido — cuándo OCURRIÓ, no cuándo lo ingerimos. Gmail la
 * trae en RFC 2822 ("Tue, 5 May 2026 11:03:00 -0500"); calendar usa `start`.
 * Devuelve null si el nodo no tiene fecha propia (ej. una nota manual, que por
 * definición es de ahora).
 */
function contentDate(n: NodeRow): Date | null {
  const meta = (n.external_metadata ?? {}) as Record<string, unknown>;
  const raw = (meta.date ?? meta.start) as string | undefined;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
): Promise<{ scanned: number; created: number; skipped: number; stale: number; errors: string[] }> {
  const stats = { scanned: 0, created: 0, skipped: 0, stale: 0, errors: [] as string[] };

  // Owner_id needed to attribute the alert (alerts.user_id NOT NULL).
  const { data: ws } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws) return stats;

  const since = new Date(Date.now() - cfg.ALERTS_LOOKBACK_MINUTES * 60_000).toISOString();

  // Fetch recent nodes in this workspace.
  //
  // Los nodos de going-bridge (commits/PRs del repo) quedan FUERA: la bandeja de
  // alertas es la bandeja personal — correo, calendario, drive, notas. Un commit
  // que el propio usuario escribio no es una accion pendiente, y sin esta
  // exclusion el 92% de las alertas eran su propio repo (y llegaban como '[Nota]',
  // indistinguibles de una nota manual, asi que el LLM las trataba como tarea).
  // El negocio ya se cubre por otra via: generateExecutiveBriefing en going-bridge.
  const { data: nodes, error } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or('external_source.is.null,external_source.neq.going')
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
  const unclassified = nodes.filter((n) => !alreadyClassified.has(n.id));

  // Descarta contenido viejo recien ingerido. `since` filtra por cuando lo
  // guardamos; esto filtra por cuando OCURRIO. Sin esto, cualquier backfill
  // (conectar Gmail, resincronizar) dispara una avalancha de alertas sobre
  // correos de hace meses — y el usuario las ve fechadas hoy.
  const maxAgeMs = cfg.ALERTS_MAX_CONTENT_AGE_DAYS * 24 * 3600_000;
  const newNodes = unclassified.filter((n) => {
    if (isBotSender(n)) return false;
    const cd = contentDate(n);
    return cd === null || Date.now() - cd.getTime() <= maxAgeMs;
  });
  stats.stale = unclassified.length - newNodes.length;
  stats.scanned = newNodes.length;
  if (newNodes.length === 0) return stats;

  // Build the LLM input.
  const prompt =
    `Escanea los siguientes ${newNodes.length} items nuevos. Devuelve el array "alerts" con SOLO los accionables.\n\n` +
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

  const totals = { scanned: 0, created: 0, skipped: 0, stale: 0 };
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
    totals.stale += stats.stale;
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
