import type { Db } from '@mycortex/db';
import type {
  EvolutionAction,
  EvolutionActionInsert,
  EvolutionRunInsert,
  EvolutionRunRow,
  EvolutionRunUpdate,
} from '@mycortex/db/types';

export async function startRun(db: Db, userId: string): Promise<EvolutionRunRow> {
  const insert: EvolutionRunInsert = { user_id: userId, status: 'running' };
  const { data, error } = await db
    .from('evolution_runs')
    .insert(insert)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function finishRun(
  db: Db,
  runId: string,
  patch: EvolutionRunUpdate,
): Promise<void> {
  const { error } = await db
    .from('evolution_runs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw error;
}

export async function recordAction(
  db: Db,
  input: {
    runId: string;
    userId: string;
    action: EvolutionAction;
    targetNodeId: string;
    sourceNodeIds: string[];
    reasoning: string | null;
    suggestedContent: string | null;
  },
): Promise<void> {
  const insert: EvolutionActionInsert = {
    run_id: input.runId,
    user_id: input.userId,
    action: input.action,
    target_node_id: input.targetNodeId,
    source_node_ids: input.sourceNodeIds,
    reasoning: input.reasoning,
    suggested_content: input.suggestedContent,
  };
  const { error } = await db.from('evolution_actions').insert(insert);
  if (error) throw error;
}
