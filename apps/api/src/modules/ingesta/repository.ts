import type { NodeInsert, NodeRow } from '@mycortex/db/types';
import { getDb } from '../../lib/db.js';

export async function insertNode(input: NodeInsert): Promise<NodeRow> {
  const { data, error } = await getDb()
    .from('nodes')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}
