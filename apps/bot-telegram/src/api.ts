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
 * Identity context for a Telegram message: which MyCortex user owns it
 * and which workspace it should land in. Resolved either from a
 * telegram_links row (multi-user mode) or the TELEGRAM_DEFAULT_USER_ID
 * fallback (legacy single-user mode, no workspace_id → personal).
 */
export type BotIdentity = {
  userId: string;
  workspaceId?: string;
};

/**
 * Server-to-server client. Uses service-role key + user_id header for the
 * api's "admin trust" auth path. Only safe inside trusted services like
 * this bot — never call from clients that hold user credentials.
 */
export class ApiClient {
  constructor(private readonly cfg: Config) {}

  private headers(id: BotIdentity): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      'X-MyCortex-User-Id': id.userId,
      'Content-Type': 'application/json',
    };
    if (id.workspaceId) h['X-MyCortex-Workspace-Id'] = id.workspaceId;
    return h;
  }

  private async post<T>(path: string, id: BotIdentity, body?: unknown): Promise<T> {
    // headers() sets Content-Type: application/json, which makes Fastify
    // reject empty bodies with FST_ERR_CTP_EMPTY_JSON_BODY. Send `{}` when
    // the caller doesn't supply a body so endpoints like /cortex/run still
    // accept POSTs.
    const res = await fetch(`${this.cfg.API_URL}${path}`, {
      method: 'POST',
      headers: this.headers(id),
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      throw new Error(`api ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, id: BotIdentity): Promise<T> {
    const res = await fetch(`${this.cfg.API_URL}${path}`, { headers: this.headers(id) });
    if (!res.ok) {
      throw new Error(`api ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  ingest(id: BotIdentity, params: { source: string; text?: string; title?: string }): Promise<IngestResponse> {
    return this.post('/ingesta', id, params);
  }

  runCortex(id: BotIdentity): Promise<CortexRunResponse> {
    return this.post('/cortex/run', id);
  }

  recentNodes(id: BotIdentity, limit = 5): Promise<{ nodes: RecentNode[] }> {
    return this.get(`/cortex/nodes?limit=${limit}`, id);
  }
}
