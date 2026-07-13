import { z } from 'zod';
import { createDb } from '@mycortex/db';
import { proposeContextUpdates } from '@mycortex/cortex-engine';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Las propuestas razonan con Claude; sin esto no hay nada que proponer.
  ANTHROPIC_API_KEY: z.string().min(1),
  CONTEXT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),
  CONTEXT_MAX_NODES: z.coerce.number().int().positive().max(200).default(60),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(extra as object) }));
}

/**
 * cortex-context: corre programado (semanal), recorre cada workspace y propone
 * hechos estables para la capa 1 (constitución). Las propuestas quedan pending
 * en context_proposals para que el usuario las apruebe/rechace. Dedup contra el
 * contexto y propuestas previas ya vive en proposeContextUpdates.
 */
async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    log('error', 'invalid_env', { issues: parsed.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = parsed.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'cortex_context_start', {
    lookbackDays: cfg.CONTEXT_LOOKBACK_DAYS,
    maxNodes: cfg.CONTEXT_MAX_NODES,
  });
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

  const totals = { workspaces: 0, withProposals: 0, created: 0, errors: 0 };

  for (const ws of workspaces) {
    totals.workspaces++;
    try {
      const { created } = await proposeContextUpdates(db, ws.id, ws.owner_id, {
        lookbackDays: cfg.CONTEXT_LOOKBACK_DAYS,
        maxNodes: cfg.CONTEXT_MAX_NODES,
      });
      if (created > 0) {
        totals.withProposals++;
        totals.created += created;
      }
    } catch (err) {
      totals.errors++;
      log('warn', 'context_workspace_failed', { workspaceId: ws.id, error: String(err).slice(0, 200) });
    }
  }

  log('info', 'cortex_context_done', { elapsedMs: Date.now() - started, ...totals });
}

main().catch((err) => {
  log('error', 'cortex_context_crashed', { error: String(err) });
  process.exit(1);
});
