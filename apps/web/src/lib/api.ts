'use client';

import { supabase } from './supabase';
import { publicConfig } from './publicConfig';

const API_URL = publicConfig.apiUrl;

const WORKSPACE_STORAGE_KEY = 'mycortex.workspaceId';

/** Get the user's currently selected workspace from localStorage (client-only). */
function getSelectedWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedWorkspaceId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    else window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  // Forward the user's selected workspace context to the api. If absent,
  // the api falls back to the user's personal workspace.
  const wsId = getSelectedWorkspaceId();
  if (wsId) headers['X-MyCortex-Workspace-Id'] = wsId;
  return headers;
}

export type IngestResult = {
  node: { id: string; kind: string; category: string; title: string | null; content: string };
  classification: { kind: string; category: string; title: string | null };
  transcript?: string;
  transcriptionMs?: number;
};

export type NoteSource = {
  kind: 'note';
  id: string;
  /** Where this source physically lives: a direct note, a Drive file, or a Gmail message. */
  origin: 'note' | 'drive' | 'gmail';
  /** File name, email subject, or note title. May be null for legacy notes. */
  title: string | null;
  /** Short human-readable label like "Drive › report.pdf" or "Gmail › 'Subject' — Sender". */
  attribution: string;
  content: string;
  category: string;
  /** Ingest source: which path created the node (web/mobile/drive/gmail/etc.). */
  source: string;
  /** Per-origin metadata (filename, mime_type, from/to/subject/date, etc.). */
  externalMetadata: Record<string, unknown> | null;
  createdAt: string;
  similarity: number;
  keywordScore: number;
  rrfScore: number;
  /** Cohere cross-encoder relevance score [0,1]; null if reranker not used. */
  rerankScore: number | null;
};

export type WebSource = {
  kind: 'web';
  title: string;
  url: string;
  snippet: string;
  score: number;
};

export type AskResult = {
  question: string;
  answer: string;
  /** Notes from the user's own second brain (semantic search). */
  sources: NoteSource[];
  /** Live web search results (Tavily) — populated when notes are weak or forced. */
  webSources: WebSource[];
  webSearched: boolean;
  webSearchedReason?: string | null;
  audioBase64?: string;
  transcriptionMs?: number;
  ttsMs?: number;
  webMs?: number;
  rerankMs?: number;
  rerankApplied?: boolean;
  candidatesEvaluated?: number;
  /** Actual search query used (post-rewrite). Equals `question` when no rewrite. */
  searchQuery?: string;
  /** Whether the rewriter changed the query. */
  queryRewritten?: boolean;
  rewriteMs?: number;
};

export type DigestCounts = {
  notes?: number;
  mails?: number;
  drive?: number;
  calendar_today?: number;
  calendar_upcoming?: number;
};

export type DigestKind = 'daily' | 'weekly';

export type DailyDigest = {
  id: string;
  for_date: string;
  kind: DigestKind;
  summary: string;
  sections: Array<{ title: string; body: string; node_ids?: string[] }>;
  counts: DigestCounts;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DigestListItem = {
  id: string;
  for_date: string;
  kind: DigestKind;
  summary: string;
  counts: DigestCounts;
  created_at: string;
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

export async function ingestText(text: string): Promise<IngestResult> {
  const res = await fetch(`${API_URL}/ingesta`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ source: 'web', text }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function ingestAudio(audioBase64: string, mimeType: string): Promise<IngestResult> {
  const res = await fetch(`${API_URL}/ingesta/audio`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ source: 'web', audioBase64, mimeType, language: 'es' }),
  });
  if (!res.ok) throw new Error(`ingest_audio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function ask(args: {
  text?: string;
  audioBase64?: string;
  mimeType?: string;
  withTTS?: boolean;
  /** Force web search even when notes match well. Default: smart fallback. */
  forceWeb?: boolean;
}): Promise<AskResult> {
  const res = await fetch(`${API_URL}/ask`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      ...args,
      ...(args.audioBase64 ? { language: 'es' } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ask ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function listRecent(limit = 20): Promise<RecentNode[]> {
  const res = await fetch(`${API_URL}/cortex/nodes?limit=${limit}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { nodes: RecentNode[] };
  return json.nodes;
}

export async function getTodaysDigest(): Promise<DailyDigest | null> {
  const res = await fetch(`${API_URL}/cortex/digest/today`, {
    headers: await authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`digest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { digest: DailyDigest };
  return json.digest;
}

export async function getLatestWeekly(): Promise<DailyDigest | null> {
  const res = await fetch(`${API_URL}/cortex/digest/latest-weekly`, {
    headers: await authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`weekly ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { digest: DailyDigest };
  return json.digest;
}

// ---- Telegram multi-user linking ---------------------------------------

export type TelegramLink = {
  chat_id: number;
  workspace_id: string;
  telegram_username: string | null;
  telegram_first_name: string | null;
  linked_at: string;
};

export type TelegramStartLinkResult = {
  token: string;
  deep_link: string | null;
  bot_username: string | null;
  expires_at: string;
};

export async function startTelegramLink(): Promise<TelegramStartLinkResult> {
  const res = await fetch(`${API_URL}/integrations/telegram/start-link`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`telegram_start ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export async function listTelegramLinks(): Promise<TelegramLink[]> {
  const res = await fetch(`${API_URL}/integrations/telegram/links`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`telegram_links ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { links: TelegramLink[] };
  return json.links;
}

export async function unlinkTelegram(chatId: number): Promise<void> {
  const res = await fetch(`${API_URL}/integrations/telegram/links/${chatId}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`telegram_unlink ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// ---- Smart alerts -------------------------------------------------------

export type AlertLevel = 'critical' | 'high' | 'low';

export type SmartAlert = {
  id: string;
  workspace_id: string;
  node_id: string;
  level: AlertLevel;
  title: string;
  action: string;
  deadline: string | null;
  context: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  acted_on_at: string | null;
  created_at: string;
};

export async function listAlerts(
  opts: { all?: boolean; limit?: number } = {},
): Promise<SmartAlert[]> {
  const url = new URL(`${API_URL}/cortex/alerts`);
  if (opts.all) url.searchParams.set('all', '1');
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`alerts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { alerts: SmartAlert[] };
  return json.alerts;
}

export async function getAlertsUnreadCount(): Promise<number> {
  const res = await fetch(`${API_URL}/cortex/alerts/unread-count`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return 0;
  const json = (await res.json()) as { count: number };
  return json.count;
}

export async function actOnAlert(
  id: string,
  action: 'read' | 'dismiss' | 'acted' | 'reopen',
): Promise<void> {
  const res = await fetch(`${API_URL}/cortex/alerts/${id}/action`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`alert ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function listDigests(
  limit = 14,
  kind?: DigestKind,
): Promise<DigestListItem[]> {
  const url = new URL(`${API_URL}/cortex/digest/list`);
  url.searchParams.set('limit', String(limit));
  if (kind) url.searchParams.set('kind', kind);
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`digest_list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { digests: DigestListItem[] };
  return json.digests;
}

// ---- Workspaces ---------------------------------------------------------

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type Workspace = {
  id: string;
  name: string;
  slug: string | null;
  is_personal: boolean;
  owner_id: string;
  created_at: string;
  role: WorkspaceRole;
};

export type WorkspaceMember = {
  user_id: string;
  email: string | null;
  role: WorkspaceRole;
  created_at: string;
};

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${API_URL}/workspaces`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`workspaces ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { workspaces: Workspace[] };
  return json.workspaces;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const res = await fetch(`${API_URL}/workspaces`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create_workspace ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { workspace: Workspace };
  return json.workspace;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/members`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`members ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { members: WorkspaceMember[] };
  return json.members;
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  role: 'admin' | 'member' | 'viewer' = 'member',
): Promise<{ member: WorkspaceMember; alreadyMember?: boolean }> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/members`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error(`invite ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { member: WorkspaceMember; already_member?: boolean };
  return { member: json.member, alreadyMember: json.already_member };
}

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`change_role ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`remove ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---- Workspace invitations (email-based, supports non-users) ------------

export type PendingInvitation = {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  email_sent_at: string | null;
  email_error: string | null;
};

export type CreateInvitationResult =
  | {
      status: 'created';
      invitation: PendingInvitation;
      email_sent: boolean;
      accept_url: string;
    }
  | { status: 'already_pending'; invitation: PendingInvitation }
  | { status: 'already_member'; email: string; role: WorkspaceRole };

export async function listInvitations(workspaceId: string): Promise<PendingInvitation[]> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/invitations`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`invitations ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { invitations: PendingInvitation[] };
  return json.invitations;
}

export async function createInvitation(
  workspaceId: string,
  email: string,
  role: 'admin' | 'member' | 'viewer' = 'member',
): Promise<CreateInvitationResult> {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/invitations`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error(`invite ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/workspaces/${workspaceId}/invitations/${invitationId}`,
    { method: 'DELETE', headers: await authHeaders() },
  );
  if (!res.ok) throw new Error(`revoke ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
