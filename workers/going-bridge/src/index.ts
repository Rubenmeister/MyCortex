import { z } from 'zod';
import { embedText } from '@mycortex/ai-core';
import { createDb } from '@mycortex/db';
import type { NodeInsert } from '@mycortex/db/types';
import { generateExecutiveBriefing } from '@mycortex/cortex-engine';
import { fetchGoingSignals } from './github.js';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GOING_GITHUB_REPO: z.string().min(3), // "owner/repo"
  GITHUB_TOKEN: z.string().min(1).optional(),
  BRIDGE_WORKSPACE_ID: z.string().uuid(),
  BRIDGE_USER_ID: z.string().uuid(),
  BRIDGE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(14),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
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

  log('info', 'going_bridge_start', { repo: cfg.GOING_GITHUB_REPO, lookbackDays: cfg.BRIDGE_LOOKBACK_DAYS });
  const started = Date.now();

  // 1. Traer señales de Going desde GitHub.
  const signals = await fetchGoingSignals(cfg.GOING_GITHUB_REPO, cfg.GITHUB_TOKEN, since);
  log('info', 'signals_fetched', { count: signals.length });

  // 2. Ingerir cada señal como nodo (external_source='going', idempotente por
  //    (workspace, external_source, external_id)). Embedding para que sean
  //    buscables y fluyan al coach/diario/grafo.
  let ingested = 0;
  for (const s of signals) {
    try {
      const text = `[${s.type}] ${s.title}\n${s.body}`;
      const embedding = await embedText(text);
      const row: NodeInsert = {
        workspace_id: cfg.BRIDGE_WORKSPACE_ID,
        user_id: cfg.BRIDGE_USER_ID,
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
      const { error } = await db
        .from('nodes')
        .upsert(row, { onConflict: 'workspace_id,external_source,external_id' });
      if (!error) ingested++;
      else log('warn', 'node_upsert_failed', { externalId: s.externalId, error: error.message.slice(0, 160) });
    } catch (err) {
      log('warn', 'signal_ingest_failed', { externalId: s.externalId, error: String(err).slice(0, 160) });
    }
  }

  // 3. Generar el briefing ejecutivo a partir de las señales ingeridas.
  let signalsAnalyzed = 0;
  try {
    const out = await generateExecutiveBriefing(db, cfg.BRIDGE_WORKSPACE_ID, cfg.BRIDGE_USER_ID, {
      lookbackDays: cfg.BRIDGE_LOOKBACK_DAYS,
    });
    signalsAnalyzed = out.signalsAnalyzed;
  } catch (err) {
    log('error', 'briefing_failed', { error: String(err).slice(0, 200) });
  }

  log('info', 'going_bridge_done', {
    elapsedMs: Date.now() - started,
    fetched: signals.length,
    ingested,
    signalsAnalyzed,
  });
}

main().catch((err) => {
  log('error', 'going_bridge_crashed', { error: String(err) });
  process.exit(1);
});
