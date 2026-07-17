import type { Db } from '@mycortex/db';
import { findCandidates, listActiveWorkspaces } from './candidates.js';
import { findNeighbors } from './cluster.js';
import { fuseCluster } from './fusion.js';
import { finishRun, recordAction, startRun } from './persist.js';

export type EvolutionRunSummary = {
  runId: string;
  workspaceId: string;
  userId: string;
  nodesExamined: number;
  clustersFound: number;
  actionsCount: number;
  byAction: Record<'merge' | 'complement' | 'correct' | 'skip', number>;
  errors: string[];
};

export type RunOptions = {
  hasAnthropicKey?: boolean;
  hasOpenAIKey?: boolean;
  lookbackHours?: number;
  similarityThreshold?: number;
  topK?: number;
};

const ZERO_BY_ACTION = {
  merge: 0,
  complement: 0,
  correct: 0,
  skip: 0,
} as const;

/**
 * Run the evolution layer for a single workspace.
 *
 * Idempotent in the sense that re-running on the same nodes will create new
 * suggestions (rows in evolution_actions) but won't double-apply anything —
 * application of suggestions is a separate user-driven step (UPDATE applied_at).
 *
 * Requires a `userId` to record on the run/actions: who triggered this run.
 * For the cron worker, pass the workspace owner_id (or a synthetic 'system'
 * user if you have one).
 */
export async function runEvolutionForWorkspace(
  db: Db,
  args: {
    workspaceId: string;
    userId: string;
  } & RunOptions,
): Promise<EvolutionRunSummary> {
  const { workspaceId, userId, ...opts } = args;
  const errors: string[] = [];
  const byAction: Record<'merge' | 'complement' | 'correct' | 'skip', number> = { ...ZERO_BY_ACTION };
  let nodesExamined = 0;
  let clustersFound = 0;
  let actionsCount = 0;
  const hasAnthropicKey = opts.hasAnthropicKey ?? false;

  const run = await startRun(db, { workspaceId, userId });

  try {
    const candidates = await findCandidates(db, workspaceId, {
      lookbackHours: opts.lookbackHours,
    });
    nodesExamined = candidates.length;

    for (const node of candidates) {
      if (!node.embedding) continue;

      let neighbors;
      try {
        neighbors = await findNeighbors(db, workspaceId, node.embedding, node.id, {
          threshold: opts.similarityThreshold,
          topK: opts.topK,
        });
      } catch (err) {
        errors.push(`neighbors_failed:${node.id}:${String(err).slice(0, 120)}`);
        continue;
      }

      if (neighbors.length > 0) clustersFound++;

      const result = await fuseCluster(node, neighbors, hasAnthropicKey);

      try {
        await recordAction(db, {
          workspaceId,
          runId: run.id,
          userId,
          action: result.action,
          targetNodeId: node.id,
          sourceNodeIds: result.affectedNodeIds,
          reasoning: result.reasoning,
          suggestedContent: result.suggestedContent,
        });
        byAction[result.action]++;
        actionsCount++;
      } catch (err) {
        errors.push(`record_failed:${node.id}:${String(err).slice(0, 120)}`);
      }
    }

    await finishRun(db, run.id, {
      status: 'completed',
      nodes_examined: nodesExamined,
      clusters_found: clustersFound,
      actions_count: actionsCount,
      summary: buildSummary(byAction, nodesExamined, clustersFound),
      error: errors.length ? errors.slice(0, 5).join(' | ') : null,
    });
  } catch (err) {
    errors.push(`fatal:${String(err).slice(0, 200)}`);
    await finishRun(db, run.id, {
      status: 'failed',
      error: errors.join(' | '),
    });
  }

  return {
    runId: run.id,
    workspaceId,
    userId,
    nodesExamined,
    clustersFound,
    actionsCount,
    byAction,
    errors,
  };
}

/**
 * Cron-worker entrypoint: iterate every workspace with recent activity and
 * run evolution for each. The owner_id of each workspace is used as the
 * triggering userId so that `evolution_runs.user_id` always points to a real
 * (and human-meaningful) user.
 */
export async function runEvolutionForAllActiveWorkspaces(
  db: Db,
  opts: RunOptions & { activeLookbackHours?: number } = {},
): Promise<EvolutionRunSummary[]> {
  const workspaceIds = await listActiveWorkspaces(db, opts.activeLookbackHours ?? 24);
  const summaries: EvolutionRunSummary[] = [];

  for (const workspaceId of workspaceIds) {
    // Resolve owner for the run record. If anything goes wrong here, we still
    // try to run with a placeholder — but a missing workspace would mean a
    // race condition with deletion, so we just skip that one.
    const { data: ws } = await db
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle();
    if (!ws) continue;

    summaries.push(
      await runEvolutionForWorkspace(db, {
        workspaceId,
        userId: ws.owner_id,
        ...opts,
      }),
    );
  }
  return summaries;
}

function buildSummary(
  byAction: Record<'merge' | 'complement' | 'correct' | 'skip', number>,
  examined: number,
  clusters: number,
): string {
  const parts = [
    `Examined ${examined} nodes`,
    `${clusters} clusters with neighbors`,
    `merge=${byAction.merge}`,
    `complement=${byAction.complement}`,
    `correct=${byAction.correct}`,
    `skip=${byAction.skip}`,
  ];
  return parts.join(' | ');
}

export type { FusionResult } from './prompts.js';
export * from './coach.js';
export * from './bridge.js';
export * from './entities.js';
export * from './context.js';
export * from './backlog.js';
