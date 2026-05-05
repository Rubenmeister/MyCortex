import { embedText } from '@mycortex/ai-core';
import { createUserDb } from '@mycortex/db';
import { getEnv } from '../../lib/env.js';
import { fetchNode, updateNode } from './repository.js';
import { searchTavily, shouldSearch } from './tavily.js';

export type EnrichmentOutcome = {
  nodeId: string;
  embedded: boolean;
  searched: boolean;
  errors: string[];
};

/**
 * Enriches a node with embedding + (eventually) web research.
 *
 * Designed to be safe to fire-and-forget: every step is wrapped, errors are
 * collected and logged but never propagated back to the caller.
 *
 * Caller passes the user JWT so the enrichment runs under that user's RLS
 * scope — the worker never sees other users' data.
 */
export async function enrichNode(nodeId: string, jwt: string): Promise<EnrichmentOutcome> {
  const env = getEnv();
  const errors: string[] = [];
  const outcome: EnrichmentOutcome = { nodeId, embedded: false, searched: false, errors };
  const db = createUserDb(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, jwt);

  let node;
  try {
    node = await fetchNode(db, nodeId);
  } catch (err) {
    errors.push(`fetch_failed:${String(err)}`);
    return outcome;
  }
  if (!node) {
    errors.push('node_not_found');
    return outcome;
  }
  if (!node.content?.trim()) {
    errors.push('empty_content');
    return outcome;
  }

  const patch: { embedding?: number[]; metadata?: Record<string, unknown> } = {};
  const meta: Record<string, unknown> = {
    ...((node.metadata as Record<string, unknown>) ?? {}),
  };

  if (env.OPENAI_API_KEY) {
    try {
      patch.embedding = await embedText(node.content);
      outcome.embedded = true;
      meta.embedded_at = new Date().toISOString();
    } catch (err) {
      errors.push(`embed_failed:${String(err)}`);
    }
  } else {
    errors.push('embed_skipped:no_openai_key');
  }

  if (shouldSearch(node.content)) {
    try {
      const results = await searchTavily(node.content);
      meta.research = results;
      outcome.searched = true;
    } catch (err) {
      errors.push(`tavily_failed:${String(err)}`);
    }
  }

  if (Object.keys(patch).length > 0 || meta !== node.metadata) {
    patch.metadata = meta;
    try {
      await updateNode(db, nodeId, patch as Parameters<typeof updateNode>[2]);
    } catch (err) {
      errors.push(`update_failed:${String(err)}`);
    }
  }

  return outcome;
}
