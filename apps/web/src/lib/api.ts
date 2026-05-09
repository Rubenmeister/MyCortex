'use client';

import { supabase } from './supabase';
import { publicConfig } from './publicConfig';

const API_URL = publicConfig.apiUrl;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
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
