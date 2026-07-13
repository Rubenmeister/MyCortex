import { z } from 'zod';
import { createDb } from '@mycortex/db';
import { extractEntities } from '@mycortex/cortex-engine';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // La extracción razona con Claude; sin esto no hay grafo.
  ANTHROPIC_API_KEY: z.string().min(1),
  ENTITIES_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),
  ENTITIES_MAX_NODES: z.coerce.number().int().positive().max(300).default(80),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(extra as object) }));
}

/**
 * cortex-entities: corre programado (Cloud Scheduler), recorre cada workspace y
 * extrae entidades de los nodos recientes para poblar el grafo (entities +
 * entity_mentions). Upsert idempotente por nombre → re-correr acumula el grafo
 * a medida que crece el corpus. Patrón: igual que cortex-coach/digest.
 */
async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    log('error', 'invalid_env', { issues: parsed.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = parsed.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'cortex_entities_start', {
    lookbackDays: cfg.ENTITIES_LOOKBACK_DAYS,
    maxNodes: cfg.ENTITIES_MAX_NODES,
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

  const totals = { workspaces: 0, withEntities: 0, entities: 0, mentions: 0, errors: 0 };

  for (const ws of workspaces) {
    totals.workspaces++;
    try {
      const { entities, mentions } = await extractEntities(db, ws.id, ws.owner_id, {
        lookbackDays: cfg.ENTITIES_LOOKBACK_DAYS,
        maxNodes: cfg.ENTITIES_MAX_NODES,
      });
      if (entities > 0) {
        totals.withEntities++;
        totals.entities += entities;
        totals.mentions += mentions;
      }
    } catch (err) {
      totals.errors++;
      log('warn', 'entities_workspace_failed', { workspaceId: ws.id, error: String(err).slice(0, 200) });
    }
  }

  log('info', 'cortex_entities_done', { elapsedMs: Date.now() - started, ...totals });
}

main().catch((err) => {
  log('error', 'cortex_entities_crashed', { error: String(err) });
  process.exit(1);
});
