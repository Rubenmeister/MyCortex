import Constants from 'expo-constants';
import { supabase } from './supabase';

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
    // authHeaders() manda Content-Type: application/json y Fastify rechaza (400)
    // un POST con ese content-type y body vacío. Sin cuerpo, enviamos '{}'.
    body: '{}',
  });
  if (!res.ok) throw new Error(`cortex ${res.status}: ${await res.text()}`);
  return res.json();
}

export type AskResult = {
  question: string;
  answer: string;
  sources: { id: string; content: string; category: string; similarity: number }[];
  audioBase64?: string;
  transcriptionMs?: number;
  ttsMs?: number;
};

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
  if (!res.ok) throw new Error(`ask ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Coach --------------------------------------------------------------

export type GrowthDomain =
  | 'salud' | 'ejercicio' | 'proyectos' | 'productividad'
  | 'aprendizaje' | 'finanzas' | 'relaciones' | 'bienestar' | 'otro';

export type CoachSuggestion = {
  domain: GrowthDomain;
  title: string;
  insight: string;
  action: string;
  horizon: 'hoy' | 'esta-semana' | 'este-mes';
  priority: 'alta' | 'media' | 'baja';
  sourceNodeIds: string[];
};

export type CoachGeneration = {
  result: { summary: string; focus: string; suggestions: CoachSuggestion[] };
  meta: { nodesAnalyzed: number; lookbackDays: number };
};

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
  if (!res.ok) throw new Error(`coach_profile ${res.status}`);
  const json = (await res.json()) as { profile: CoachProfile | null };
  return json.profile;
}

export async function refreshCoachProfile(): Promise<CoachProfile> {
  const res = await fetch(`${API_URL}/coach/profile/refresh`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`coach_profile_refresh ${res.status}`);
  const json = (await res.json()) as { profile: CoachProfile };
  return json.profile;
}

export async function generateCoach(lookbackDays?: number, save = false): Promise<CoachGeneration> {
  const body: Record<string, unknown> = {};
  if (lookbackDays) body.lookbackDays = lookbackDays;
  if (save) body.save = true;
  const res = await fetch(`${API_URL}/coach/suggestions`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`coach ${res.status}: ${await res.text()}`);
  return res.json();
}

// Sugerencias persistidas (bandeja de seguimiento) + su ciclo de vida.
export type CoachSuggestionStatus = 'pending' | 'done' | 'dismissed' | 'snoozed';

export type PersistedCoachSuggestion = {
  id: string;
  domain: GrowthDomain;
  title: string;
  insight: string;
  action: string;
  horizon: 'hoy' | 'esta-semana' | 'este-mes';
  priority: 'alta' | 'media' | 'baja';
  status: CoachSuggestionStatus;
  task_id: string | null;
  task_status: 'todo' | 'doing' | 'done' | null;
};

export async function listCoachSuggestions(): Promise<PersistedCoachSuggestion[]> {
  const res = await fetch(`${API_URL}/coach/suggestions/list?limit=100`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`coach_list ${res.status}`);
  const json = (await res.json()) as { suggestions: PersistedCoachSuggestion[] };
  return json.suggestions;
}

export async function actOnCoachSuggestion(
  id: string,
  action: 'done' | 'dismiss' | 'snooze' | 'reopen',
): Promise<void> {
  const res = await fetch(`${API_URL}/coach/suggestions/${id}/action`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`coach_action ${res.status}`);
}

/** Convierte una sugerencia persistida en tarea del tablero (idempotente). */
export async function suggestionToTask(id: string): Promise<{ task: Task; alreadyExisted: boolean }> {
  const res = await fetch(`${API_URL}/coach/suggestions/${id}/to-task`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`to_task ${res.status}`);
  return res.json();
}

// ---- Tareas -------------------------------------------------------------

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'alta' | 'media' | 'baja';

export type Task = {
  id: string;
  title: string;
  detail: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  origin: string;
  created_at: string;
};

export async function listTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/tasks?limit=200`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`tasks ${res.status}`);
  const json = (await res.json()) as { tasks: Task[] };
  return json.tasks;
}

export async function createTask(title: string): Promise<void> {
  const res = await fetch(`${API_URL}/tasks`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`create_task ${res.status}`);
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const res = await fetch(`${API_URL}/tasks/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`update_task ${res.status}`);
}

export async function extractTasks(): Promise<{ created: number }> {
  const res = await fetch(`${API_URL}/tasks/extract`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`extract ${res.status}`);
  return res.json();
}

// ---- Contexto curado (capa 1) -------------------------------------------

export type WorkspaceContext = { body: string; updated_at: string | null };
export type ContextProposal = {
  id: string;
  section: string;
  text: string;
  rationale: string | null;
  status: 'pending' | 'accepted' | 'rejected';
};

export async function getContext(): Promise<WorkspaceContext> {
  const res = await fetch(`${API_URL}/context`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`context ${res.status}`);
  const json = (await res.json()) as { context: WorkspaceContext };
  return json.context;
}

export async function saveContext(body: string): Promise<WorkspaceContext> {
  const res = await fetch(`${API_URL}/context`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`save_context ${res.status}`);
  const json = (await res.json()) as { context: WorkspaceContext };
  return json.context;
}

export async function listContextProposals(): Promise<ContextProposal[]> {
  const res = await fetch(`${API_URL}/context/proposals`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`context_proposals ${res.status}`);
  const json = (await res.json()) as { proposals: ContextProposal[] };
  return json.proposals;
}

export async function proposeContext(): Promise<{ created: number }> {
  const res = await fetch(`${API_URL}/context/propose`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`propose ${res.status}`);
  return res.json();
}

export async function acceptContextProposal(id: string): Promise<{ body?: string }> {
  const res = await fetch(`${API_URL}/context/proposals/${id}/accept`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`accept ${res.status}`);
  return res.json();
}

export async function rejectContextProposal(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/context/proposals/${id}/reject`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`reject ${res.status}`);
}

// ---- Chat (Hablar) ------------------------------------------------------

export type ChatMessage = { id?: string; role: 'user' | 'assistant'; content: string };

export async function getChatHistory(): Promise<ChatMessage[]> {
  const res = await fetch(`${API_URL}/coach/chat?limit=50`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`chat_history ${res.status}`);
  const json = (await res.json()) as { messages: ChatMessage[] };
  return json.messages;
}

export async function sendChat(message: string): Promise<string> {
  const res = await fetch(`${API_URL}/coach/chat`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { reply: string };
  return json.reply;
}

// ---- Diario -------------------------------------------------------------

export type CoachEpisode = {
  id: string;
  label: string;
  narrative: string;
  themes: string[];
  mood: string;
  progress: string;
  loose_threads: string[];
  nodes_analyzed: number;
  created_at: string;
};

export async function listEpisodes(): Promise<CoachEpisode[]> {
  const res = await fetch(`${API_URL}/coach/episodes?limit=12`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`episodes ${res.status}`);
  const json = (await res.json()) as { episodes: CoachEpisode[] };
  return json.episodes;
}

export async function generateEpisode(): Promise<void> {
  const res = await fetch(`${API_URL}/coach/episodes/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`episode ${res.status}`);
}

// ---- Grafo --------------------------------------------------------------

export type EntityType = 'persona' | 'proyecto' | 'organizacion' | 'lugar' | 'tema' | 'otro';
export type Entity = { id: string; name: string; type: EntityType; summary: string; mention_count: number };
export type EntityNode = { id: string; title: string | null; content: string; created_at: string };
export type EntityDetail = {
  entity: Entity & { aliases: string[] };
  nodes: EntityNode[];
  related: Array<{ id: string; name: string; type: EntityType; count: number }>;
};

export async function listEntities(): Promise<Entity[]> {
  const res = await fetch(`${API_URL}/entities`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`entities ${res.status}`);
  const json = (await res.json()) as { entities: Entity[] };
  return json.entities;
}

export async function getEntity(id: string): Promise<EntityDetail> {
  const res = await fetch(`${API_URL}/entities/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`entity ${res.status}`);
  return res.json();
}

export async function extractEntities(): Promise<{ entities: number; mentions: number }> {
  const res = await fetch(`${API_URL}/entities/extract`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`extract ${res.status}`);
  return res.json();
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
export type PrepSource = { id: string; origin: string; title: string | null; snippet: string };
export type MeetingPrep = { event: AgendaEvent; brief: string; sources: PrepSource[] };

export async function getUpcomingEvents(days = 7): Promise<AgendaEvent[]> {
  const res = await fetch(`${API_URL}/agenda/upcoming?days=${days}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`agenda ${res.status}`);
  const json = (await res.json()) as { events: AgendaEvent[] };
  return json.events;
}

export async function getMeetingPrep(eventNodeId: string): Promise<MeetingPrep> {
  const res = await fetch(`${API_URL}/agenda/prep`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ eventNodeId }),
  });
  if (!res.ok) throw new Error(`prep ${res.status}`);
  return res.json();
}

// ---- Going (briefing ejecutivo) -----------------------------------------

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
  created_at: string;
  external_metadata: { type?: string; severity?: string | null } | null;
};
export type BridgeSource = {
  id: string;
  repo: string;
  status: string;
  last_synced_at: string | null;
  has_token: boolean;
};

export async function getBriefing(): Promise<ExecutiveBriefing | null> {
  const res = await fetch(`${API_URL}/bridge/briefing`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`briefing ${res.status}`);
  const json = (await res.json()) as { briefing: ExecutiveBriefing | null };
  return json.briefing;
}

export async function generateBriefing(): Promise<void> {
  const res = await fetch(`${API_URL}/bridge/briefing/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!res.ok) throw new Error(`briefing_gen ${res.status}`);
}

export async function getGoingSignals(): Promise<GoingSignal[]> {
  const res = await fetch(`${API_URL}/bridge/signals?limit=30`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`signals ${res.status}`);
  const json = (await res.json()) as { signals: GoingSignal[] };
  return json.signals;
}

export async function listBridgeSources(): Promise<BridgeSource[]> {
  const res = await fetch(`${API_URL}/bridge/sources`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`sources ${res.status}`);
  const json = (await res.json()) as { sources: BridgeSource[] };
  return json.sources;
}

export async function addBridgeSource(repo: string): Promise<void> {
  const res = await fetch(`${API_URL}/bridge/sources`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ repo }),
  });
  if (!res.ok) throw new Error(`add_source ${res.status}: ${await res.text()}`);
}
