/**
 * Tavily web search client.
 *
 * Used as a fallback in /ask when the user's notes don't have strong matches
 * for a query. Tavily returns clean, summarized search results with source
 * URLs — much cleaner than raw web scraping.
 *
 * Free tier: 1000 queries/month at https://tavily.com.
 */

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
};

export type TavilySearchOptions = {
  searchDepth?: 'basic' | 'advanced';
  includeAnswer?: boolean;
  maxResults?: number;
  /** Restrict to specific domains (whitelist) */
  includeDomains?: string[];
  /** Exclude specific domains (blacklist) */
  excludeDomains?: string[];
};

export type TavilySearchResponse = {
  query: string;
  /** Tavily's own LLM-generated answer summary (only if includeAnswer) */
  answer?: string;
  results: TavilyResult[];
  responseTime: number;
};

/**
 * Call Tavily search API. Throws on network or auth errors.
 *
 * Caller should wrap in try/catch and degrade gracefully — web search is a
 * nice-to-have, not a hard dependency for /ask.
 */
export async function tavilySearch(
  query: string,
  apiKey: string,
  opts: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  // Minimal Response shape so we don't depend on the global Response type
  // resolving the same way across host environments.
  type FetchLikeResponse = {
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  };

  const res = (await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: opts.searchDepth ?? 'basic',
      include_answer: opts.includeAnswer ?? true,
      include_raw_content: false,
      max_results: opts.maxResults ?? 5,
      include_domains: opts.includeDomains,
      exclude_domains: opts.excludeDomains,
    }),
  })) as unknown as FetchLikeResponse;

  if (!res.ok) {
    throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    query: string;
    answer?: string;
    results: Array<{
      title: string;
      url: string;
      content: string;
      score: number;
      published_date?: string;
    }>;
    response_time: number;
  };

  return {
    query: json.query,
    answer: json.answer,
    results: json.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
      publishedDate: r.published_date,
    })),
    responseTime: json.response_time,
  };
}
