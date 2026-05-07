import Constants from 'expo-constants';
import { supabase } from './supabase.js';

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export type IngestResult = {
  node: {
    id: string;
    kind: string;
    category: string;
    title: string | null;
    content: string;
    created_at: string;
  };
  classification: { kind: string; category: string; title: string | null };
  transcript?: string;
  transcriptionMs?: number;
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

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function ingestText(text: string): Promise<IngestResult> {
  const res = await fetch(`${API_URL}/ingesta`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ source: 'mobile', text }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function ingestAudio(args: {
  audioBase64: string;
  mimeType: string;
  language?: string;
}): Promise<IngestResult> {
  const res = await fetch(`${API_URL}/ingesta/audio`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ source: 'mobile', ...args }),
  });
  if (!res.ok) throw new Error(`ingest_audio ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function listRecent(limit = 10): Promise<RecentNode[]> {
  const res = await fetch(`${API_URL}/cortex/nodes?limit=${limit}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { nodes: RecentNode[] };
  return json.nodes;
}

export async function runCortex(): Promise<{
  runId: string;
  nodesExamined: number;
  clustersFound: number;
  actionsCount: number;
  byAction: { merge: number; complement: number; correct: number; skip: number };
}> {
  const res = await fetch(`${API_URL}/cortex/run`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`cortex ${res.status}: ${await res.text()}`);
  return res.json();
}
