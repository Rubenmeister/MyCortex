import type { Db } from '@mycortex/db';

export type Neighbor = {
  id: string;
  content: string;
  category: 'going' | 'personal' | 'urgent' | 'unknown';
  similarity: number;
};

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_TOP_K = 5;

/**
 * Find neighbors of a node via the match_nodes RPC. The neighbor with the
 * highest similarity is the target node itself (similarity ≈ 1) — we strip it.
 */
export async function findNeighbors(
  db: Db,
  userId: string,
  embedding: string,
  excludeNodeId: string,
  opts?: { threshold?: number; topK?: number },
): Promise<Neighbor[]> {
  const parsed = parseEmbedding(embedding);
  if (!parsed) return [];

  const { data, error } = await db.rpc('match_nodes', {
    query_embedding: parsed,
    query_user_id: userId,
    match_count: (opts?.topK ?? DEFAULT_TOP_K) + 1,
    match_threshold: opts?.threshold ?? DEFAULT_THRESHOLD,
  });
  if (error) throw error;

  return (data ?? [])
    .filter((n) => n.id !== excludeNodeId)
    .slice(0, opts?.topK ?? DEFAULT_TOP_K);
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.every((v) => typeof v === 'number') ? arr : null;
  } catch {
    return null;
  }
}
