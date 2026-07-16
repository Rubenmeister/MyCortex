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

// ---- WhatsApp multi-user linking ---------------------------------------

export type WhatsAppLink = {
  phone_number: string;
  workspace_id: string;
  display_name: string | null;
  linked_at: string;
};

export type WhatsAppStartLinkResult = {
  token: string;
  display_number: string | null;
  message_to_send: string;
  expires_at: string;
};

export async function startWhatsAppLink(): Promise<WhatsAppStartLinkResult> {
  const res = await fetch(`${API_URL}/integrations/whatsapp/start-link`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) {
    throw new Error(`whatsapp_start ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export async function listWhatsAppLinks(): Promise<WhatsAppLink[]> {
  const res = await fetch(`${API_URL}/integrations/whatsapp/links`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`whatsapp_links ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { links: WhatsAppLink[] };
  return json.links;
}

export async function unlinkWhatsApp(phone: string): Promise<void> {
  const res = await fetch(`${API_URL}/integrations/whatsapp/links/${encodeURIComponent(phone)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`whatsapp_unlink ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
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
  // authHeaders() sets Content-Type: application/json, so Fastify rejects
  // empty bodies with FST_ERR_CTP_EMPTY_JSON_BODY. Send {} to satisfy the
  // parser even though the endpoint takes no params.
  const res = await fetch(`${API_URL}/integrations/telegram/start-link`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
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

// ---- Coach (sugerencias de crecimiento personal) ------------------------

export type GrowthDomain =
  | 'salud'
  | 'ejercicio'
  | 'proyectos'
  | 'productividad'
  | 'aprendizaje'
  | 'finanzas'
  | 'relaciones'
  | 'bienestar'
  | 'otro';

export type CoachSuggestion = {
  domain: GrowthDomain;
  title: string;
  insight: string;
  action: string;
  horizon: 'hoy' | 'esta-semana' | 'este-mes';
  priority: 'alta' | 'media' | 'baja';
  sourceNodeIds: string[];
};

export type CoachResult = {
  summary: string;
  focus: string;
  suggestions: CoachSuggestion[];
};

export type CoachCitedNode = { title: string | null; origin: string; snippet: string };

export type CoachGeneration = {
  result: CoachResult;
  meta: {
    nodesAnalyzed: number;
    lookbackDays: number;
    generatedAt: string;
    droppedCitations: number;
  };
  citedNodes: Record<string, CoachCitedNode>;
};

/**
 * Pide al coach un análisis de crecimiento personal sobre el material del
 * workspace. Es una llamada cara (razonamiento Claude sobre el corpus), así
 * que el FE la dispara on-demand, no en cada render.
 */
export async function getCoachSuggestions(
  lookbackDays?: number,
  save = false,
): Promise<CoachGeneration> {
  const body: Record<string, unknown> = {};
  if (lookbackDays) body.lookbackDays = lookbackDays;
  if (save) body.save = true;
  const res = await fetch(`${API_URL}/coach/suggestions`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`coach ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- Coach: sugerencias persistidas + seguimiento -----------------------

export type CoachSuggestionStatus = 'pending' | 'done' | 'dismissed' | 'snoozed';

export type PersistedCoachSuggestion = {
  id: string;
  domain: GrowthDomain;
  title: string;
  insight: string;
  action: string;
  horizon: 'hoy' | 'esta-semana' | 'este-mes';
  priority: 'alta' | 'media' | 'baja';
  source_node_ids: string[];
  status: CoachSuggestionStatus;
  snoozed_until: string | null;
  created_at: string;
  /** Tarea enlazada, si esta sugerencia ya se convirtió en tarea. */
  task_id: string | null;
  task_status: TaskStatus | null;
};

export async function listCoachSuggestions(
  opts: { all?: boolean; limit?: number } = {},
): Promise<PersistedCoachSuggestion[]> {
  const url = new URL(`${API_URL}/coach/suggestions/list`);
  if (opts.all) url.searchParams.set('all', '1');
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`coach_list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { suggestions: PersistedCoachSuggestion[] };
  return json.suggestions;
}

export async function actOnCoachSuggestion(
  id: string,
  action: 'done' | 'dismiss' | 'snooze' | 'reopen',
  days?: number,
): Promise<void> {
  const res = await fetch(`${API_URL}/coach/suggestions/${id}/action`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...(days ? { days } : {}) }),
  });
  if (!res.ok) throw new Error(`coach_action ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Convierte una sugerencia persistida en tarea del tablero (cierra el loop
 * Coach → Productividad). Idempotente: si ya era tarea, devuelve la existente.
 */
export async function suggestionToTask(id: string): Promise<{ task: Task; alreadyExisted: boolean }> {
  const res = await fetch(`${API_URL}/coach/suggestions/${id}/to-task`, {
    method: 'POST',
    headers: await authHeaders(),
    // authHeaders() siempre manda Content-Type: application/json, y Fastify
    // rechaza (400) un POST con ese content-type y body vacío. Sin cuerpo que
    // enviar, mandamos '{}'.
    body: '{}',
  });
  if (!res.ok) throw new Error(`to_task ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- Coach: perfil que te conoce ----------------------------------------

export type CoachProfile = {
  summary: string;
  focus_areas: string[];
  goals: string[];
  routines: string;
  trends: string;
  wellbeing: string;
  nodes_analyzed: number;
  updated_at: string;
};

export async function getCoachProfile(): Promise<CoachProfile | null> {
  const res = await fetch(`${API_URL}/coach/profile`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`coach_profile ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { profile: CoachProfile | null };
  return json.profile;
}

export async function refreshCoachProfile(): Promise<CoachProfile> {
  const res = await fetch(`${API_URL}/coach/profile/refresh`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`coach_profile_refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { profile: CoachProfile };
  return json.profile;
}

// ---- Coach: diario / memoria episódica ----------------------------------

export type CoachEpisode = {
  id: string;
  period_start: string;
  period_end: string;
  label: string;
  narrative: string;
  themes: string[];
  mood: string;
  progress: string;
  loose_threads: string[];
  nodes_analyzed: number;
  created_at: string;
};

export async function listEpisodes(limit = 12): Promise<CoachEpisode[]> {
  const res = await fetch(`${API_URL}/coach/episodes?limit=${limit}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`episodes ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { episodes: CoachEpisode[] };
  return json.episodes;
}

export async function generateEpisode(): Promise<CoachEpisode> {
  const res = await fetch(`${API_URL}/coach/episodes/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`episode ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { episode: CoachEpisode };
  return json.episode;
}

// ---- Coach: chat conversacional -----------------------------------------

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
};

export async function getChatHistory(limit = 50): Promise<ChatMessage[]> {
  const res = await fetch(`${API_URL}/coach/chat?limit=${limit}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`chat_history ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { messages: ChatMessage[] };
  return json.messages;
}

export async function sendChat(message: string): Promise<string> {
  const res = await fetch(`${API_URL}/coach/chat`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { reply: string };
  return json.reply;
}

// ---- Grafo de entidades -------------------------------------------------

export type EntityType = 'persona' | 'proyecto' | 'organizacion' | 'lugar' | 'tema' | 'otro';

export type Entity = {
  id: string;
  name: string;
  type: EntityType;
  summary: string;
  mention_count: number;
  last_seen: string | null;
};

export type EntityNode = {
  id: string;
  title: string | null;
  content: string;
  source: string;
  external_source: string | null;
  created_at: string;
};

export type EntityDetail = {
  entity: Entity & { aliases: string[] };
  nodes: EntityNode[];
  related: Array<{ id: string; name: string; type: EntityType; count: number }>;
};

export async function listEntities(type?: EntityType): Promise<Entity[]> {
  const url = new URL(`${API_URL}/entities`);
  if (type) url.searchParams.set('type', type);
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`entities ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { entities: Entity[] };
  return json.entities;
}

export async function getEntity(id: string): Promise<EntityDetail> {
  const res = await fetch(`${API_URL}/entities/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`entity ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function extractEntities(lookbackDays?: number): Promise<{ entities: number; mentions: number }> {
  const res = await fetch(`${API_URL}/entities/extract`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(lookbackDays ? { lookbackDays } : {}),
  });
  if (!res.ok) throw new Error(`entities_extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- Puente Going (briefing ejecutivo) ----------------------------------

export type ExecutiveBriefing = {
  id: string;
  summary: string;
  health: string;
  risks: string[];
  priorities: string[];
  signals_analyzed: number;
  created_at: string;
};

export type GoingSignal = {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
  external_metadata: { type?: string; severity?: string | null; url?: string | null } | null;
};

export async function getBriefing(): Promise<ExecutiveBriefing | null> {
  const res = await fetch(`${API_URL}/bridge/briefing`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`briefing ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { briefing: ExecutiveBriefing | null };
  return json.briefing;
}

export async function generateBriefing(): Promise<{ signalsAnalyzed: number }> {
  const res = await fetch(`${API_URL}/bridge/briefing/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`briefing_gen ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function getGoingSignals(limit = 40): Promise<GoingSignal[]> {
  const res = await fetch(`${API_URL}/bridge/signals?limit=${limit}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`signals ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { signals: GoingSignal[] };
  return json.signals;
}

export type BridgeSource = {
  id: string;
  provider: 'github';
  repo: string;
  status: 'active' | 'paused' | 'error';
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  has_token: boolean;
};

export async function listBridgeSources(): Promise<BridgeSource[]> {
  const res = await fetch(`${API_URL}/bridge/sources`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`sources ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { sources: BridgeSource[] };
  return json.sources;
}

export async function addBridgeSource(repo: string, accessToken?: string): Promise<void> {
  const res = await fetch(`${API_URL}/bridge/sources`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ repo, ...(accessToken ? { accessToken } : {}) }),
  });
  if (!res.ok) throw new Error(`add_source ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function removeBridgeSource(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/bridge/sources/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`remove_source ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---- Agenda -------------------------------------------------------------

export type AgendaEvent = {
  nodeId: string;
  title: string;
  start: string | null;
  end: string | null;
  location: string | null;
  attendees: string[];
  description: string;
};

export type PrepSource = {
  id: string;
  origin: 'note' | 'drive' | 'gmail';
  title: string | null;
  snippet: string;
  similarity: number;
};

export type MeetingPrep = {
  event: AgendaEvent;
  brief: string;
  sources: PrepSource[];
};

export async function getUpcomingEvents(days = 7): Promise<AgendaEvent[]> {
  const res = await fetch(`${API_URL}/agenda/upcoming?days=${days}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`agenda ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { events: AgendaEvent[] };
  return json.events;
}

export async function getMeetingPrep(eventNodeId: string): Promise<MeetingPrep> {
  const res = await fetch(`${API_URL}/agenda/prep`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ eventNodeId }),
  });
  if (!res.ok) throw new Error(`prep ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- Tasks --------------------------------------------------------------

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'alta' | 'media' | 'baja';

export type Task = {
  id: string;
  title: string;
  detail: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  origin: 'manual' | 'coach' | 'extracted' | 'meeting';
  source_node_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function listTasks(
  opts: { status?: TaskStatus; limit?: number } = {},
): Promise<Task[]> {
  const url = new URL(`${API_URL}/tasks`);
  if (opts.status) url.searchParams.set('status', opts.status);
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`tasks ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { tasks: Task[] };
  return json.tasks;
}

export async function createTask(input: {
  title: string;
  detail?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  origin?: 'manual' | 'coach' | 'extracted' | 'meeting';
  sourceNodeId?: string | null;
}): Promise<Task> {
  const res = await fetch(`${API_URL}/tasks`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create_task ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { task: Task };
  return json.task;
}

export async function updateTask(
  id: string,
  patch: { title?: string; detail?: string | null; status?: TaskStatus; priority?: TaskPriority; dueDate?: string | null },
): Promise<void> {
  const res = await fetch(`${API_URL}/tasks/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update_task ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/tasks/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`delete_task ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function extractTasks(lookbackDays?: number): Promise<{ created: number; tasks: Task[] }> {
  const res = await fetch(`${API_URL}/tasks/extract`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(lookbackDays ? { lookbackDays } : {}),
  });
  if (!res.ok) throw new Error(`extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- Contexto curado (capa 1: "la constitución") ------------------------

export type WorkspaceContext = { body: string; updated_at: string | null };

export type ContextProposal = {
  id: string;
  section: string;
  text: string;
  rationale: string | null;
  source_node_ids: string[];
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
};

export async function getContext(): Promise<WorkspaceContext> {
  const res = await fetch(`${API_URL}/context`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`context ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { context: WorkspaceContext };
  return json.context;
}

export async function saveContext(body: string): Promise<WorkspaceContext> {
  const res = await fetch(`${API_URL}/context`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`save_context ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { context: WorkspaceContext };
  return json.context;
}

export async function listContextProposals(all = false): Promise<ContextProposal[]> {
  const url = new URL(`${API_URL}/context/proposals`);
  if (all) url.searchParams.set('all', '1');
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`context_proposals ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { proposals: ContextProposal[] };
  return json.proposals;
}

/** Pide a la IA proponer hechos estables desde tu material reciente. */
export async function proposeContext(lookbackDays?: number): Promise<{ created: number }> {
  const res = await fetch(`${API_URL}/context/propose`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(lookbackDays ? { lookbackDays } : {}),
  });
  if (!res.ok) throw new Error(`propose ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Aceptar una propuesta → se fusiona en la constitución. Devuelve el body nuevo. */
export async function acceptContextProposal(id: string): Promise<{ body?: string }> {
  const res = await fetch(`${API_URL}/context/proposals/${id}/accept`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`accept ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function rejectContextProposal(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/context/proposals/${id}/reject`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`reject ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
