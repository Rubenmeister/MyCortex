import { z } from 'zod';
import { generateText, models } from '@mycortex/ai-core';
import { createDb, meterAi, type Db } from '@mycortex/db';
import type {
  DailyDigestInsert,
  DigestCounts,
  DigestSection,
  NodeRow,
} from '@mycortex/db/types';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  /**
   * Digest type:
   *   'daily'  → 24h window, morning briefing (default)
   *   'weekly' → 7d window, Monday reflection
   */
  DIGEST_KIND: z.enum(['daily', 'weekly']).default('daily'),
  /** Generate digest for a specific date (YYYY-MM-DD). Defaults to "today" in UTC. */
  DIGEST_FOR_DATE: z.string().optional(),
  /** Run digest only for a specific workspace (uuid). Defaults to all active workspaces. */
  DIGEST_WORKSPACE_ID: z.string().uuid().optional(),
  /** Cap items per surface so the LLM context stays manageable. */
  DIGEST_MAX_ITEMS_PER_SURFACE: z.coerce.number().int().positive().default(15),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Pull the previous-24h-worth-of-content slice from each surface that
 * contributed to a workspace's brain. We treat each surface separately
 * so we can show counts + structured sections in the digest rather than
 * a single undifferentiated blob.
 */
type DigestInputs = {
  newMails: NodeRow[];
  newDocs: NodeRow[];
  newNotes: NodeRow[];
  todayEvents: NodeRow[];
  upcomingEvents: NodeRow[];
};

async function gatherInputs(
  db: Db,
  workspaceId: string,
  forDate: Date,
  kind: 'daily' | 'weekly',
  maxPerSurface: number,
): Promise<DigestInputs> {
  // Daily: cover 24h before forDate's 00:00 UTC. Morning briefing semantics.
  // Weekly: cover 7d ending at forDate (typically a Monday). The week
  //   that just closed.
  const day = new Date(forDate);
  day.setUTCHours(0, 0, 0, 0);
  const windowDays = kind === 'weekly' ? 7 : 1;
  const since = new Date(day.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const untilIso = day.toISOString();

  // Calendar: daily shows today + 3d ahead; weekly shows the upcoming 7d
  // (the week starting at `day`).
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const upcomingEnd = new Date(
    day.getTime() + (kind === 'weekly' ? 7 : 4) * 24 * 60 * 60 * 1000,
  );

  // --- New mails ingested in the last 24h
  const { data: mails } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'gmail')
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso)
    .order('created_at', { ascending: false })
    .limit(maxPerSurface);

  // --- New Drive docs ingested in the last 24h
  const { data: docs } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'drive')
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso)
    .order('created_at', { ascending: false })
    .limit(maxPerSurface);

  // --- New raw notes (captures from web/mobile/telegram/api)
  const { data: notes } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('external_source', null)
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso)
    .order('created_at', { ascending: false })
    .limit(maxPerSurface);

  // --- Calendar: events happening today (range filter on metadata->start)
  // We over-fetch then filter in-memory since Postgres jsonb range filters
  // are awkward and the volume here is small.
  const { data: allCalendar } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'calendar')
    .order('created_at', { ascending: false })
    .limit(200);

  const todayEvents: NodeRow[] = [];
  const upcomingEvents: NodeRow[] = [];
  for (const node of allCalendar ?? []) {
    const meta = (node.external_metadata ?? {}) as { start?: string | null };
    if (!meta.start) continue;
    const start = new Date(meta.start);
    if (Number.isNaN(start.getTime())) continue;
    if (start >= day && start < dayEnd) {
      todayEvents.push(node);
    } else if (start >= dayEnd && start < upcomingEnd) {
      upcomingEvents.push(node);
    }
  }
  todayEvents.sort((a, b) => {
    const ma = (a.external_metadata as { start?: string })?.start ?? '';
    const mb = (b.external_metadata as { start?: string })?.start ?? '';
    return ma.localeCompare(mb);
  });
  upcomingEvents.sort((a, b) => {
    const ma = (a.external_metadata as { start?: string })?.start ?? '';
    const mb = (b.external_metadata as { start?: string })?.start ?? '';
    return ma.localeCompare(mb);
  });

  return {
    newMails: mails ?? [],
    newDocs: docs ?? [],
    newNotes: notes ?? [],
    todayEvents: todayEvents.slice(0, maxPerSurface),
    upcomingEvents: upcomingEvents.slice(0, maxPerSurface),
  };
}

/**
 * Format a node as a single line suitable for inclusion in the LLM prompt.
 * We give the LLM enough structure (source + title + snippet + date) to
 * write a faithful summary, but cap content length so we don't blow the
 * context window.
 */
function nodeLine(n: NodeRow): string {
  const meta = (n.external_metadata ?? {}) as Record<string, unknown>;
  const title = n.title ?? '(sin título)';
  if (n.external_source === 'gmail') {
    const from = (meta.from as string | undefined) ?? '';
    const fromShort = from.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim() ?? from;
    return `[Gmail] "${title}" — de ${fromShort.slice(0, 40)}\n    ${n.content.slice(0, 300).replace(/\s+/g, ' ')}`;
  }
  if (n.external_source === 'drive') {
    const filename = (meta.filename as string | undefined) ?? title;
    return `[Drive] ${filename}\n    ${n.content.slice(0, 300).replace(/\s+/g, ' ')}`;
  }
  if (n.external_source === 'calendar') {
    const start = (meta.start as string | undefined) ?? '';
    const where = (meta.location as string | undefined) ?? '';
    return `[Calendar] ${start} — ${title}${where ? ` @ ${where}` : ''}\n    ${n.content.slice(0, 300).replace(/\s+/g, ' ')}`;
  }
  return `[Nota] ${title}\n    ${n.content.slice(0, 300).replace(/\s+/g, ' ')}`;
}

const DAILY_PROMPT = `Eres CORTEX, el asistente personal del usuario. Tu rol AHORA es generar el briefing de la mañana — una versión condensada y accionable de lo que pasó ayer + lo que viene hoy.

Formato (markdown):
1. **Resumen general** (2-3 oraciones): el "estado" del día. Qué demanda atención HOY.
2. **Mails que importan** (hasta 5 bullets): lo nuevo en Gmail. Para cada uno: remitente, asunto, lo accionable.
3. **Tu agenda de hoy**: eventos ordenados cronológicamente. Si hay conflictos, marcalos.
4. **Esta semana** (hasta 3 bullets): eventos próximos importantes.
5. **Material nuevo**: notas + docs Drive nuevos. Una línea por item con qué es.

Reglas:
- Concretitud > genericidad. "Datafast necesita la documentación pendiente para mañana" > "Hay correspondencia pendiente con Datafast".
- Si una sección está vacía, OMITILA. No escribas "No hay eventos hoy".
- Match el idioma del contenido del usuario (probablemente español).
- Sin emojis innecesarios. Sin saludos. Directo al grano.
- Si NADA pasó (todas las secciones vacías), respondé solo: "Día tranquilo. Sin novedades."

Tu output va directo a la pantalla de morning briefing. Sé útil.`;

const WEEKLY_PROMPT = `Eres CORTEX, el asistente personal del usuario. Tu rol AHORA es generar la reflexión semanal — qué se hizo, qué quedó pendiente, qué viene.

A diferencia del briefing diario (foco en lo accionable inmediato), la reflexión semanal busca PATRONES y CONTEXTO. La idea es que el lunes a la mañana el usuario tenga un "mapa" claro de la semana que terminó y la que arranca.

Formato (markdown):
1. **Resumen ejecutivo** (3-4 oraciones): el "tema" de la semana pasada. Avances, bloqueos, decisiones clave.
2. **Hitos y entregables**: qué se cerró, qué quedó a medias. Identificá conversaciones que avanzaron significativamente y dónde quedaron.
3. **Pendientes que se arrastran** (hasta 5 bullets): items donde se ven varios mensajes pero ninguna resolución. Resaltá lo que probablemente va a seguir abierto si no actuás.
4. **Agenda de la próxima semana**: eventos próximos, con énfasis en preparación necesaria.
5. **Patrones observados** (opcional, 2-3 bullets): repeticiones temáticas, áreas que demandaron mucho tiempo, cambios de prioridad.

Reglas:
- Cita personas, empresas, números, fechas concretas. NO uses "el cliente", "el equipo" sin nombrarlos.
- Si detectás un hilo de mails con muchas idas y vueltas sin cierre, marcalo explícitamente: "Pendiente cerrar con X: ya hubo Y intercambios sin resolución".
- Match el idioma del contenido (probablemente español).
- Sin saludos. Sin emojis innecesarios. Tono ejecutivo.
- Si la semana fue tranquila: "Semana tranquila. Sin novedades de peso."

Tu output va directo a la pantalla de weekly reflection los lunes a la mañana.`;

type LLMResult = { summary: string; sections: DigestSection[] };

async function generateDigest(
  db: Db,
  workspaceId: string,
  inputs: DigestInputs,
  forDateIso: string,
  kind: 'daily' | 'weekly',
): Promise<LLMResult> {
  const windowLabel = kind === 'weekly' ? 'última semana' : 'últimas 24h';
  const upcomingLabel = kind === 'weekly' ? 'PRÓXIMA SEMANA' : 'siguientes 3 días';
  const todayLabel = kind === 'weekly' ? `LUNES ${forDateIso}` : forDateIso;

  const sections: { heading: string; lines: string[] }[] = [];
  if (inputs.newMails.length > 0) {
    sections.push({
      heading: `MAILS (${windowLabel})`,
      lines: inputs.newMails.map(nodeLine),
    });
  }
  if (inputs.todayEvents.length > 0) {
    sections.push({
      heading: `EVENTOS DE ${todayLabel}`,
      lines: inputs.todayEvents.map(nodeLine),
    });
  }
  if (inputs.upcomingEvents.length > 0) {
    sections.push({
      heading: `EVENTOS PRÓXIMOS (${upcomingLabel})`,
      lines: inputs.upcomingEvents.map(nodeLine),
    });
  }
  if (inputs.newDocs.length > 0) {
    sections.push({
      heading: `DOCS DRIVE (${windowLabel})`,
      lines: inputs.newDocs.map(nodeLine),
    });
  }
  if (inputs.newNotes.length > 0) {
    sections.push({
      heading: `NOTAS (${windowLabel})`,
      lines: inputs.newNotes.map(nodeLine),
    });
  }

  // Truly empty window — short-circuit without LLM.
  if (sections.length === 0) {
    return {
      summary:
        kind === 'weekly'
          ? 'Semana tranquila. Sin novedades de peso.'
          : 'Día tranquilo. Sin novedades en tu segundo cerebro.',
      sections: [],
    };
  }

  const headerLabel =
    kind === 'weekly'
      ? `REFLEXIÓN SEMANAL — Semana cerrando ${forDateIso}`
      : `BRIEFING — ${forDateIso}`;
  const prompt =
    `${headerLabel}\n\n` +
    sections.map((s) => `=== ${s.heading} ===\n${s.lines.join('\n\n')}`).join('\n\n');

  const result = await generateText({
    model: models.reasoner,
    system: kind === 'weekly' ? WEEKLY_PROMPT : DAILY_PROMPT,
    prompt,
    maxTokens: kind === 'weekly' ? 2200 : 1500,
  });
  void meterAi(db, workspaceId, models.reasoner.modelId, result.usage);

  return { summary: result.text.trim(), sections: [] };
}

async function digestForWorkspace(
  db: Db,
  workspaceId: string,
  forDate: Date,
  cfg: z.infer<typeof EnvSchema>,
): Promise<{ skipped: boolean; reason?: string }> {
  const kind = cfg.DIGEST_KIND;
  // Look up the owning user for this workspace — needed for daily_digests.user_id.
  const { data: ws } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws) return { skipped: true, reason: 'workspace_not_found' };

  const inputs = await gatherInputs(db, workspaceId, forDate, kind, cfg.DIGEST_MAX_ITEMS_PER_SURFACE);
  const counts: DigestCounts = {
    mails: inputs.newMails.length,
    drive: inputs.newDocs.length,
    notes: inputs.newNotes.length,
    calendar_today: inputs.todayEvents.length,
    calendar_upcoming: inputs.upcomingEvents.length,
  };

  const forDateIso = forDate.toISOString().slice(0, 10);

  const llmStart = Date.now();
  let summary: string;
  let sections: DigestSection[];
  try {
    const res = await generateDigest(db, workspaceId, inputs, forDateIso, kind);
    summary = res.summary;
    sections = res.sections;
  } catch (err) {
    log('error', 'digest_llm_failed', { workspaceId, kind, err: String(err).slice(0, 200) });
    return { skipped: true, reason: 'llm_failed' };
  }
  const llmMs = Date.now() - llmStart;

  const insert: DailyDigestInsert = {
    workspace_id: workspaceId,
    user_id: ws.owner_id,
    for_date: forDateIso,
    kind,
    summary,
    sections,
    counts,
    metadata: { llmMs, model: 'claude-sonnet-4-6', inputs_total: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) },
  };

  // Upsert so re-running for the same (workspace, for_date, kind) overwrites.
  const { error } = await db
    .from('daily_digests')
    .upsert(insert, { onConflict: 'workspace_id,for_date,kind' });
  if (error) {
    log('error', 'digest_db_insert_failed', { workspaceId, kind, err: error.message });
    return { skipped: true, reason: 'db_failed' };
  }

  log('info', 'digest_generated', {
    workspaceId,
    kind,
    for_date: forDateIso,
    counts,
    llmMs,
    summaryChars: summary.length,
  });
  return { skipped: false };
}

async function main(): Promise<void> {
  const env = EnvSchema.safeParse(process.env);
  if (!env.success) {
    log('error', 'invalid_env', { issues: env.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = env.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  const forDate = cfg.DIGEST_FOR_DATE ? new Date(cfg.DIGEST_FOR_DATE) : new Date();
  log('info', 'digest_start', {
    kind: cfg.DIGEST_KIND,
    for_date: forDate.toISOString().slice(0, 10),
  });

  // Pick which workspaces to run for. If DIGEST_WORKSPACE_ID is set we
  // run only that one (used for manual testing). Otherwise we run for
  // every workspace that has at least one active sync_source or one
  // recent node — i.e., workspaces that are actually being used.
  let workspaceIds: string[];
  if (cfg.DIGEST_WORKSPACE_ID) {
    workspaceIds = [cfg.DIGEST_WORKSPACE_ID];
  } else {
    const { data: rows, error } = await db
      .from('workspaces')
      .select('id');
    if (error) {
      log('error', 'list_workspaces_failed', { err: error.message });
      process.exit(1);
    }
    workspaceIds = (rows ?? []).map((r) => r.id);
  }

  const started = Date.now();
  let generated = 0;
  let skipped = 0;
  for (const wsId of workspaceIds) {
    const result = await digestForWorkspace(db, wsId, forDate, cfg);
    if (result.skipped) skipped++;
    else generated++;
  }

  log('info', 'digest_done', {
    elapsedMs: Date.now() - started,
    workspaces: workspaceIds.length,
    generated,
    skipped,
  });
}

main().catch((err) => {
  log('error', 'digest_crashed', { error: String(err) });
  process.exit(1);
});
