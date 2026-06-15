import { z } from 'zod';
import { createDb } from '@mycortex/db';
import { generateCoachSuggestions, persistCoachGeneration } from '@mycortex/cortex-engine';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // El coach razona con Claude; sin esto no hay coaching.
  ANTHROPIC_API_KEY: z.string().min(1),
  COACH_LOOKBACK_DAYS: z.coerce.number().int().positive().default(45),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(extra as object) }));
}

/**
 * cortex-coach: corre semanalmente (Cloud Scheduler), genera el coaching de
 * crecimiento por workspace y lo persiste en coach_runs + coach_suggestions
 * para habilitar el seguimiento. Patrón: igual que cortex-cron/digest.
 */
async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    log('error', 'invalid_env', { issues: parsed.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = parsed.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'cortex_coach_start', { lookbackDays: cfg.COACH_LOOKBACK_DAYS });
  const started = Date.now();

  const { data: workspaces, error } = await db.from('workspaces').select('id, owner_id');
  if (error) {
    log('error', 'list_workspaces_failed', { error: error.message });
    process.exit(1);
  }
  if (!workspaces || workspaces.length === 0) {
    log('info', 'no_workspaces');
    return;
  }

  const totals = { workspaces: 0, withSuggestions: 0, inserted: 0, errors: 0 };

  for (const ws of workspaces) {
    totals.workspaces++;
    try {
      const gen = await generateCoachSuggestions(db, ws.id, { lookbackDays: cfg.COACH_LOOKBACK_DAYS });
      if (gen.result.suggestions.length === 0) continue;
      const { inserted } = await persistCoachGeneration(db, ws.id, ws.owner_id, gen);
      if (inserted > 0) {
        totals.withSuggestions++;
        totals.inserted += inserted;
      }
    } catch (err) {
      totals.errors++;
      log('warn', 'coach_workspace_failed', { workspaceId: ws.id, error: String(err).slice(0, 200) });
    }
  }

  log('info', 'cortex_coach_done', { elapsedMs: Date.now() - started, ...totals });
}

main().catch((err) => {
  log('error', 'cortex_coach_crashed', { error: String(err) });
  process.exit(1);
});
