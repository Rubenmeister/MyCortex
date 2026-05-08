import type { Db } from '@mycortex/db';

export type Neighbor = {
  id: string;
  content: string;
  category: 'going' | 'personal' | 'urgent' | 'unknown';
  similarity: number;
};

// 0.4 is calibrated for OpenAI text-embedding-3-small. Lower than the 0.7
// you'd use with ada-002 — the newer model produces lower absolute cosine
// similarities for semantically equivalent content. Verified empirically:
// related notes score 0.45–0.60, unrelated < 0.25.
const DEFAULT_THRESHOLD = 0.4;
const DEFAULT_TOP_K = 5;

/**
 * Find neighbors of a node via the match_nodes RPC. The neighbor with the
 * highest similarity is the target node itself (similarity ≈ 1) — we strip it.
 * Scoped to a workspace.
 */
export async function findNeighbors(
  db: Db,
  workspaceId: string,
  embedding: string,
  excludeNodeId: string,
  opts?: { threshold?: number; topK?: number },
): Promise<Neighbor[]> {
  const parsed = parseEmbedding(embedding);
  if (!parsed) return [];

  const { data, error } = await db.rpc('match_nodes', {
    query_embedding: parsed,
    query_workspace_id: workspaceId,
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
