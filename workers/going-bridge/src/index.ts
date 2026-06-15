import { z } from 'zod';
import { embedText } from '@mycortex/ai-core';
import { createDb, type Db } from '@mycortex/db';
import type { NodeInsert } from '@mycortex/db/types';
import { generateExecutiveBriefing } from '@mycortex/cortex-engine';
import { fetchGoingSignals, type Signal } from './github.js';

// Multi-tenant: el worker ya NO lee un repo/workspace fijo de env vars. Itera
// las fuentes activas de TODOS los workspaces (tabla bridge_sources), que cada
// cliente conecta desde la UI. Embeddings + Claude via OpenAI/Anthropic.
const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  BRIDGE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(14),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Ingiere una señal como nodo (external_source='going') en un workspace.
 * Upsert manual: el índice único de nodes es PARCIAL (where external_id is not
 * null) y PostgREST no puede expresar ese WHERE en su ON CONFLICT.
 */
async function ingestSignal(db: Db, workspaceId: string, userId: string, s: Signal): Promise<boolean> {
  const embedding = await embedText(`[${s.type}] ${s.title}\n${s.body}`);
  const row: NodeInsert = {
    workspace_id: workspaceId,
    user_id: userId,
    kind: 'reference',
    category: 'going',
    title: s.title,
    content: s.body || s.title,
    source: 'api',
    embedding,
    external_source: 'going',
    external_id: s.externalId,
    external_metadata: { type: s.type, severity: s.severity ?? null, url: s.url ?? null, ts: s.ts },
  };
  const { data: existing } = await db
    .from('nodes')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'going')
    .eq('external_id', s.externalId)
    .maybeSingle();
  let error;
  if (existing) {
    ({ error } = await db
      .from('nodes')
      .update({ title: row.title, content: row.content, embedding, external_metadata: row.external_metadata })
      .eq('id', existing.id));
  } else {
    ({ error } = await db.from('nodes').insert(row));
  }
  if (error) {
    log('warn', 'node_upsert_failed', { externalId: s.externalId, error: error.message.slice(0, 160) });
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    log('error', 'invalid_env', { issues: parsed.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = parsed.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - cfg.BRIDGE_LOOKBACK_DAYS * 24 * 3600_000).toISOString();
  const started = Date.now();

  log('info', 'going_bridge_start', { lookbackDays: cfg.BRIDGE_LOOKBACK_DAYS });

  const { data: sources, error } = await db
    .from('bridge_sources')
    .select('id, workspace_id, user_id, repo, access_token')
    .eq('status', 'active');
  if (error) {
    log('error', 'list_sources_failed', { error: error.message });
    process.exit(1);
  }
  if (!sources || sources.length === 0) {
    log('info', 'no_active_sources');
    return;
  }

  const totals = { sources: 0, fetched: 0, ingested: 0, briefings: 0, errors: 0 };
  // workspace_id -> un user_id (para atribuir el briefing).
  const workspacesTouched = new Map<string, string>();

  for (const src of sources) {
    totals.sources++;
    try {
      const signals = await fetchGoingSignals(src.repo, src.access_token ?? undefined, since);
      totals.fetched += signals.length;
      for (const s of signals) {
        try {
          if (await ingestSignal(db, src.workspace_id, src.user_id, s)) totals.ingested++;
        } catch (err) {
          log('warn', 'signal_ingest_failed', { repo: src.repo, externalId: s.externalId, error: String(err).slice(0, 160) });
        }
      }
      workspacesTouched.set(src.workspace_id, src.user_id);
      // Mantenemos status='active' aunque haya errores transitorios (auto-retry
      // el próximo run); solo registramos last_synced_at / last_error.
      await db
        .from('bridge_sources')
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq('id', src.id);
    } catch (err) {
      totals.errors++;
      const msg = String(err).slice(0, 300);
      log('warn', 'source_failed', { repo: src.repo, error: msg });
      await db.from('bridge_sources').update({ last_error: msg }).eq('id', src.id);
    }
  }

  // Un briefing ejecutivo por workspace que recibió señales.
  for (const [workspaceId, userId] of workspacesTouched) {
    try {
      await generateExecutiveBriefing(db, workspaceId, userId, { lookbackDays: cfg.BRIDGE_LOOKBACK_DAYS });
      totals.briefings++;
    } catch (err) {
      log('error', 'briefing_failed', { workspaceId, error: String(err).slice(0, 200) });
    }
  }

  log('info', 'going_bridge_done', { elapsedMs: Date.now() - started, ...totals });
}

main().catch((err) => {
  log('error', 'going_bridge_crashed', { error: String(err) });
  process.exit(1);
});
