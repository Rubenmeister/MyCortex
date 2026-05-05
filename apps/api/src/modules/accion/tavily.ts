import { getEnv } from '../../lib/env.js';

export type TavilyResult = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Placeholder: Tavily integration. Today we always skip — enrichment is local
 * (embedding only). When activated, we'll: heuristic decide whether to search,
 * call Tavily API, summarize hits with Claude, store as metadata.research[].
 *
 * For now: keeps the plumbing in place so /accion/enrich does the right thing
 * once we flip the switch.
 */
export function shouldSearch(_text: string): boolean {
  return false;
}

export async function searchTavily(_query: string): Promise<TavilyResult[]> {
  const env = getEnv();
  if (!env.TAVILY_API_KEY) return [];
  // TODO: implement when shouldSearch starts returning true
  return [];
}
