import { z } from 'zod';

/**
 * Cohere Rerank — improves retrieval precision by re-scoring (query, doc)
 * pairs with a cross-encoder trained specifically for ranking. Works
 * roughly 10x better than pure cosine similarity for distinguishing
 * "shares vocabulary" from "actually answers the question".
 *
 * Model: rerank-multilingual-v3.0 (handles ES + EN + many others).
 *
 * Pricing: free tier covers 1k reranks/month, then $1/1000 reranks.
 * Latency: ~150ms for 20 docs.
 *
 * If the API key isn't set, we return the inputs unchanged in their
 * original order — caller decides whether to bail or proceed without
 * rerank.
 */

const RerankResultSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      relevance_score: z.number(),
    }),
  ),
});

export type RerankedHit<T> = {
  /** Original document. */
  doc: T;
  /** Cohere's relevance score in [0,1]. Higher = more relevant. */
  score: number;
  /** Original index in the input array. Useful for tracing. */
  originalIndex: number;
};

/**
 * Re-rank an array of documents against a query. Returns the inputs
 * sorted by relevance with the rerank score attached.
 *
 * @param query  The user's question.
 * @param docs   Documents to score, each with a `text` string used for
 *               scoring. The full doc is preserved in the output.
 * @param apiKey Cohere API key.
 * @param opts   topN: only return the top N results. model: override
 *               the default rerank model.
 */
export async function cohereRerank<T extends { text: string }>(
  query: string,
  docs: T[],
  apiKey: string,
  opts: { topN?: number; model?: string } = {},
): Promise<RerankedHit<T>[]> {
  if (docs.length === 0) return [];
  const model = opts.model ?? 'rerank-multilingual-v3.0';
  const topN = opts.topN ?? docs.length;

  const res = await fetch('https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      query,
      documents: docs.map((d) => d.text),
      top_n: topN,
    }),
  });
  if (!res.ok) {
    throw new Error(`cohere_rerank_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const parsed = RerankResultSchema.parse(await res.json());
  return parsed.results.map((r) => ({
    doc: docs[r.index]!,
    score: r.relevance_score,
    originalIndex: r.index,
  }));
}
