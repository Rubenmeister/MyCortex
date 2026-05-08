import type { Db } from '@mycortex/db';
import type { NodeRow } from '@mycortex/db/types';

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_LIMIT = 50;

/**
 * Find nodes that need evolution analysis: recent + has embedding.
 * Scoped to a workspace.
 */
export async function findCandidates(
  db: Db,
  workspaceId: string,
  opts?: { lookbackHours?: number; limit?: number },
): Promise<NodeRow[]> {
  const lookback = opts?.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const since = new Date(Date.now() - lookback * 3600_000).toISOString();

  const { data, error } = await db
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .not('embedding', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * List workspaces with activity in the lookback window. Used by the cron
 * worker to know who to process this run.
 */
export async function listActiveWorkspaces(db: Db, lookbackHours = 24): Promise<string[]> {
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
  const { data, error } = await db
    .from('nodes')
    .select('workspace_id')
    .gte('created_at', since);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.workspace_id)));
}
