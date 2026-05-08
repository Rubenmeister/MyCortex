import { z } from 'zod';
import { createDb } from '@mycortex/db';
import { runEvolutionForAllActiveWorkspaces } from '@mycortex/cortex-engine';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  EVOLUTION_LOOKBACK_HOURS: z.coerce.number().positive().default(24),
  EVOLUTION_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),
  EVOLUTION_TOP_K: z.coerce.number().int().positive().default(5),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(extra as object) }));
}

async function main(): Promise<void> {
  const env = EnvSchema.safeParse(process.env);
  if (!env.success) {
    log('error', 'invalid_env', { issues: env.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = env.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'cortex_cron_start', {
    lookback: cfg.EVOLUTION_LOOKBACK_HOURS,
    threshold: cfg.EVOLUTION_SIMILARITY_THRESHOLD,
    topK: cfg.EVOLUTION_TOP_K,
    hasAnthropic: Boolean(cfg.ANTHROPIC_API_KEY),
  });

  const started = Date.now();
  const summaries = await runEvolutionForAllActiveWorkspaces(db, {
    hasAnthropicKey: Boolean(cfg.ANTHROPIC_API_KEY),
    hasOpenAIKey: Boolean(cfg.OPENAI_API_KEY),
    lookbackHours: cfg.EVOLUTION_LOOKBACK_HOURS,
    similarityThreshold: cfg.EVOLUTION_SIMILARITY_THRESHOLD,
    topK: cfg.EVOLUTION_TOP_K,
  });
  const elapsedMs = Date.now() - started;

  const totals = summaries.reduce(
    (acc, s) => ({
      workspaces: acc.workspaces + 1,
      examined: acc.examined + s.nodesExamined,
      clusters: acc.clusters + s.clustersFound,
      actions: acc.actions + s.actionsCount,
      errors: acc.errors + s.errors.length,
    }),
    { workspaces: 0, examined: 0, clusters: 0, actions: 0, errors: 0 },
  );

  log('info', 'cortex_cron_done', { elapsedMs, ...totals });
}

main().catch((err) => {
  log('error', 'cortex_cron_crashed', { error: String(err) });
  process.exit(1);
});
