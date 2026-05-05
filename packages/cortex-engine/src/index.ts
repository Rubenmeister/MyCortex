import type { Db } from '@mycortex/db';
import { findCandidates, listActiveUsers } from './candidates.js';
import { findNeighbors } from './cluster.js';
import { fuseCluster } from './fusion.js';
import { finishRun, recordAction, startRun } from './persist.js';

export type EvolutionRunSummary = {
  runId: string;
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
 * Run the evolution layer for a single user.
 *
 * Idempotent in the sense that re-running on the same nodes will create new
 * suggestions (rows in evolution_actions) but won't double-apply anything —
 * application of suggestions is a separate user-driven step (UPDATE applied_at).
 */
export async function runEvolutionForUser(
  db: Db,
  userId: string,
  opts: RunOptions = {},
): Promise<EvolutionRunSummary> {
  const errors: string[] = [];
  const byAction: Record<'merge' | 'complement' | 'correct' | 'skip', number> = { ...ZERO_BY_ACTION };
  let nodesExamined = 0;
  let clustersFound = 0;
  let actionsCount = 0;
  const hasAnthropicKey = opts.hasAnthropicKey ?? false;

  const run = await startRun(db, userId);

  try {
    const candidates = await findCandidates(db, userId, { lookbackHours: opts.lookbackHours });
    nodesExamined = candidates.length;

    for (const node of candidates) {
      if (!node.embedding) continue;

      let neighbors;
      try {
        neighbors = await findNeighbors(db, userId, node.embedding, node.id, {
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
      status: errors.length === 0 ? 'completed' : 'completed',
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
    userId,
    nodesExamined,
    clustersFound,
    actionsCount,
    byAction,
    errors,
  };
}

export async function runEvolutionForAllActiveUsers(
  db: Db,
  opts: RunOptions & { activeUsersLookbackHours?: number } = {},
): Promise<EvolutionRunSummary[]> {
  const userIds = await listActiveUsers(db, opts.activeUsersLookbackHours ?? 24);
  const summaries: EvolutionRunSummary[] = [];
  for (const userId of userIds) {
    summaries.push(await runEvolutionForUser(db, userId, opts));
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
