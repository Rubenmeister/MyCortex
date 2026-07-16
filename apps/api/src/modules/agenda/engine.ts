import { cohereRerank, embedText, generateText, models } from '@mycortex/ai-core';
import { buildContextBlock } from '@mycortex/cortex-engine';
import type { Db } from '@mycortex/db';
import { incrementAiOps, limitsFor } from '../../lib/plans.js';
import { MEETING_PREP_SYSTEM_PROMPT } from './prompts.js';

/** Evento de agenda derivado de un nodo de calendario. */
export type AgendaEvent = {
  nodeId: string;
  title: string;
  start: string | null;
  end: string | null;
  location: string | null;
  attendees: string[];
  description: string;
};

type CalNode = {
  id: string;
  title: string | null;
  content: string;
  external_id: string | null;
  external_metadata: Record<string, unknown> | null;
  created_at: string;
};

function toEvent(n: CalNode): AgendaEvent {
  const m = (n.external_metadata ?? {}) as Record<string, unknown>;
  const attendeesRaw = m.attendees;
  const attendees = Array.isArray(attendeesRaw)
    ? attendeesRaw.map((a) => String(a)).slice(0, 20)
    : [];
  return {
    nodeId: n.id,
    title: n.title ?? (m.summary as string | undefined) ?? '(evento sin título)',
    start: (m.start as string | undefined) ?? null,
    end: (m.end as string | undefined) ?? null,
    location: (m.location as string | undefined) ?? null,
    attendees,
    description: n.content.slice(0, 600),
  };
}

/**
 * Eventos próximos del workspace, derivados de los nodos de calendario que
 * ingiere el worker calendar-sync. Filtramos y ordenamos por `start` en JS
 * (el campo vive en jsonb) para no depender de operadores de path en PostgREST.
 */
export async function getUpcomingEvents(
  db: Db,
  workspaceId: string,
  opts: { days?: number } = {},
): Promise<AgendaEvent[]> {
  const days = opts.days ?? 7;
  const now = Date.now();
  const horizon = now + days * 24 * 3600_000;

  const { data, error } = await db
    .from('nodes')
    .select('id, title, content, external_id, external_metadata, created_at')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'calendar')
    .limit(400);
  if (error) throw new Error(`agenda_fetch_failed:${error.message}`);

  return (data as CalNode[] | null ?? [])
    .map(toEvent)
    .filter((e) => {
      if (!e.start) return false;
      const t = new Date(e.start).getTime();
      return !Number.isNaN(t) && t >= now - 3600_000 && t <= horizon;
    })
    .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime());
}

type HybridMatch = {
  id: string;
  title: string | null;
  content: string;
  external_source: string | null;
  external_metadata: Record<string, unknown> | null;
  similarity: number;
  created_at: string;
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

/**
 * Arma un brief de preparación para un evento: busca en el segundo cerebro lo
 * relacionado (hybrid search, excluyendo otros eventos de calendario) y deja
 * que Claude escriba el brief. Reutiliza el RPC match_nodes_hybrid de /ask.
 */
export async function buildMeetingPrep(
  db: Db,
  workspaceId: string,
  eventNodeId: string,
  env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; COHERE_API_KEY?: string },
): Promise<MeetingPrep> {
  const { data: nodeData, error: nodeErr } = await db
    .from('nodes')
    .select('id, title, content, external_id, external_metadata, created_at')
    .eq('workspace_id', workspaceId)
    .eq('id', eventNodeId)
    .maybeSingle();
  if (nodeErr) throw new Error(`agenda_event_fetch_failed:${nodeErr.message}`);
  if (!nodeData) throw new Error('event_not_found');
  const event = toEvent(nodeData as CalNode);

  const query = `${event.title}\n${event.attendees.join(', ')}\n${event.description}`.trim();
  const queryEmbedding = await embedText(query);
  const { data: matches, error: searchErr } = await db.rpc('match_nodes_hybrid', {
    query_embedding: queryEmbedding,
    query_text: `${event.title} ${event.attendees.join(' ')}`,
    query_workspace_id: workspaceId,
    match_count: 20,
    match_threshold: 0.25,
  });
  if (searchErr) throw new Error(`agenda_search_failed:${searchErr.message}`);

  // Excluimos el propio evento y otros nodos de calendario (queremos notas,
  // mails y docs que den contexto, no la grilla de eventos).
  let candidates = ((matches ?? []) as HybridMatch[]).filter(
    (m) => m.id !== eventNodeId && m.external_source !== 'calendar',
  );

  // Rerank premium: Pro+ (así lo promete /pricing). En free degrada al orden
  // híbrido (el else de abajo), sin perder la funcionalidad.
  const planLimits = await limitsFor(db, workspaceId);
  if (planLimits.cohere && env.COHERE_API_KEY && candidates.length > 1) {
    try {
      const reranked = await cohereRerank(
        query,
        candidates.map((c) => ({ ...c, text: c.title ? `${c.title}\n\n${c.content}` : c.content })),
        env.COHERE_API_KEY,
        { topN: 6 },
      );
      candidates = reranked.map((r) => r.doc as HybridMatch);
    } catch {
      candidates = candidates.slice(0, 6);
    }
  } else {
    candidates = candidates.slice(0, 6);
  }

  const sources: PrepSource[] = candidates.map((c) => ({
    id: c.id,
    origin:
      c.external_source === 'drive' ? 'drive' : c.external_source === 'gmail' ? 'gmail' : 'note',
    title: c.title,
    snippet: c.content.slice(0, 200).replace(/\s+/g, ' ').trim(),
    similarity: c.similarity,
  }));

  if (!env.ANTHROPIC_API_KEY) {
    return { event, brief: 'Falta configurar ANTHROPIC_API_KEY para generar el brief.', sources };
  }

  const ctx =
    sources.length === 0
      ? 'No hay material relacionado en el segundo cerebro.'
      : sources
          .map(
            (s, i) =>
              `[N${i + 1}] ${s.origin}${s.title ? ` · ${s.title}` : ''} (sim=${s.similarity.toFixed(2)})\n      ${s.snippet}`,
          )
          .join('\n');

  const contextBlock = await buildContextBlock(db, workspaceId);
  const userPrompt = `${contextBlock}EVENTO:
Título: ${event.title}
Cuándo: ${event.start ?? 's/f'}${event.location ? `\nDónde: ${event.location}` : ''}${event.attendees.length ? `\nAsistentes: ${event.attendees.join(', ')}` : ''}
Descripción: ${event.description || '(sin descripción)'}

CONTEXTO (tu segundo cerebro):
${ctx}`;

  const { text } = await generateText({
    model: models.reasoner,
    system: MEETING_PREP_SYSTEM_PROMPT,
    prompt: userPrompt,
    maxTokens: 1200,
  });
  void incrementAiOps(workspaceId);

  return { event, brief: text.trim(), sources };
}
