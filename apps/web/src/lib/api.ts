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

export type AskResult = {
  question: string;
  answer: string;
  sources: { id: string; content: string; category: string; similarity: number }[];
  audioBase64?: string;
  transcriptionMs?: number;
  ttsMs?: number;
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
