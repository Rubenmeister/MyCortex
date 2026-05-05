import type { Db } from '@mycortex/db';
import type { Json, NodeRow, NodeUpdate } from '@mycortex/db/types';

export async function fetchNode(db: Db, nodeId: string): Promise<NodeRow | null> {
  const { data, error } = await db.from('nodes').select('*').eq('id', nodeId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateNode(
  db: Db,
  nodeId: string,
  patch: NodeUpdate,
): Promise<NodeRow> {
  const { data, error } = await db
    .from('nodes')
    .update(patch)
    .eq('id', nodeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function mergeMetadata(
  db: Db,
  nodeId: string,
  patch: Record<string, Json>,
): Promise<void> {
  const node = await fetchNode(db, nodeId);
  if (!node) return;
  const merged: Record<string, Json> = {
    ...(node.metadata as Record<string, Json>),
    ...patch,
  };
  await updateNode(db, nodeId, { metadata: merged });
}
