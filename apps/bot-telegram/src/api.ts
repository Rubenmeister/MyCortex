import type { Config } from './config.js';

export type IngestResponse = {
  node: {
    id: string;
    kind: string;
    category: string;
    title: string | null;
    content: string;
    created_at: string;
  };
  classification: {
    kind: string;
    category: string;
    title: string | null;
  };
};

export type CortexRunResponse = {
  runId: string;
  nodesExamined: number;
  clustersFound: number;
  actionsCount: number;
  byAction: { merge: number; complement: number; correct: number; skip: number };
};

export type RecentNode = {
  id: string;
  kind: string;
  category: string;
  title: string | null;
  content: string;
  source: string;
  created_at: string;
};

/**
 * Server-to-server client. Uses service-role key + user_id header for the
 * api's "admin trust" auth path. Only safe inside trusted services like
 * this bot — never call from clients that hold user credentials.
 */
export class ApiClient {
  constructor(private readonly cfg: Config) {}

  private headers(userId: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      'X-MyCortex-User-Id': userId,
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(path: string, userId: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.API_URL}${path}`, {
      method: 'POST',
      headers: this.headers(userId),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`api ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, userId: string): Promise<T> {
    const res = await fetch(`${this.cfg.API_URL}${path}`, { headers: this.headers(userId) });
    if (!res.ok) {
      throw new Error(`api ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  ingest(userId: string, params: { source: string; text?: string; title?: string }): Promise<IngestResponse> {
    return this.post('/ingesta', userId, params);
  }

  runCortex(userId: string): Promise<CortexRunResponse> {
    return this.post('/cortex/run', userId);
  }

  recentNodes(userId: string, limit = 5): Promise<{ nodes: RecentNode[] }> {
    return this.get(`/cortex/nodes?limit=${limit}`, userId);
  }
}
