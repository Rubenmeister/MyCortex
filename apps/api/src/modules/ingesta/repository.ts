import type { Db } from '@mycortex/db';
import type { NodeInsert, NodeRow } from '@mycortex/db/types';

export async function insertNode(db: Db, input: NodeInsert): Promise<NodeRow> {
  const { data, error } = await db.from('nodes').insert(input).select().single();
  if (error) throw error;
  return data;
}
