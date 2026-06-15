import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import { CoachResultSchema, COACH_SYSTEM_PROMPT, type CoachResult } from './prompts.js';

/** Nodo mínimo que el coach necesita para razonar + citar. */
type CoachNode = {
  id: string;
  title: string | null;
  content: string;
  source: string;
  category: string;
  created_at: string;
  external_source: string | null;
  external_metadata: Record<string, unknown> | null;
};

export type CoachOptions = {
  /** Ventana de material a analizar. Default 45 días. */
  lookbackDays?: number;
  /** Tope de nodos enviados al LLM (control de costo/tokens). Default 80. */
  maxNodes?: number;
};

export type CoachGeneration = {
  result: CoachResult;
  meta: {
    nodesAnalyzed: number;
    lookbackDays: number;
    generatedAt: string;
    droppedCitations: number;
  };
  /** Resolución id→etiqueta de los nodos citados, para que el FE muestre la fuente. */
  citedNodes: Record<string, { title: string | null; origin: string; snippet: string }>;
};

const DEFAULT_LOOKBACK_DAYS = 45;
const DEFAULT_MAX_NODES = 80;
const MIN_NODES_FOR_COACHING = 3;

/** Origen legible de un nodo (de dónde salió físicamente). */
function originOf(n: CoachNode): string {
  return n.external_source ?? n.source ?? 'nota';
}

/** Línea compacta de un nodo para el prompt, con su UUID para que el LLM cite. */
function nodeLine(n: CoachNode): string {
  const meta = (n.external_metadata ?? {}) as Record<string, unknown>;
  const date = (meta.date as string | undefined) ?? n.created_at;
  const title = n.title ?? '(sin título)';
  const body = n.content.slice(0, 500).replace(/\s+/g, ' ').trim();
  return `[${originOf(n)}] id=${n.id} fecha=${date.slice(0, 10)} cat=${n.category}\nTítulo: ${title}\n${body}`;
}

/**
 * Genera sugerencias de crecimiento personal a partir del material del
 * workspace. Pensado para reutilizarse desde un worker proactivo (fase 2)
 * sin cambios: recibe el `db` y el `workspaceId`, no depende de la request.
 */
export async function generateCoachSuggestions(
  db: Db,
  workspaceId: string,
  opts: CoachOptions = {},
): Promise<CoachGeneration> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const since = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();
  const generatedAt = new Date().toISOString();

  const { data, error } = await db
    .from('nodes')
    .select('id, title, content, source, category, created_at, external_source, external_metadata')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(maxNodes);
  if (error) throw new Error(`coach_fetch_failed:${error.message}`);

  const nodes = (data ?? []) as CoachNode[];

  // Sin material suficiente: devolvemos un encuadre honesto en vez de alucinar.
  if (nodes.length < MIN_NODES_FOR_COACHING) {
    return {
      result: {
        summary:
          'Todavía no tengo suficiente material tuyo para darte un coaching útil. Cuantas más notas, mails, documentos y eventos conecte, mejores serán mis sugerencias.',
        focus:
          'Cargá unas notas sobre tus proyectos y metas actuales (o conectá Gmail/Drive/Calendar) y volvé a pedirme sugerencias.',
        suggestions: [],
      },
      meta: { nodesAnalyzed: nodes.length, lookbackDays, generatedAt, droppedCitations: 0 },
      citedNodes: {},
    };
  }

  const prompt =
    `Analizá el siguiente material del usuario (${nodes.length} ítems de los últimos ${lookbackDays} días) ` +
    `y generá su coaching de crecimiento personal. Citá en sourceNodeIds los ítems que uses.\n\n` +
    nodes.map((n) => `===\n${nodeLine(n)}`).join('\n');

  const { object } = await generateObject({
    model: models.reasoner, // Claude — mejor razonamiento para coaching.
    schema: CoachResultSchema,
    system: COACH_SYSTEM_PROMPT,
    prompt,
    maxTokens: 8000,
  });

  // Anti-alucinación: descartamos citas a nodos que no estaban en el corpus.
  const validIds = new Set(nodes.map((n) => n.id));
  let droppedCitations = 0;
  const cleaned = object.suggestions.map((s) => {
    const kept = s.sourceNodeIds.filter((id) => validIds.has(id));
    droppedCitations += s.sourceNodeIds.length - kept.length;
    return { ...s, sourceNodeIds: kept };
  });

  // Mapa id→etiqueta solo de los nodos efectivamente citados.
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const citedNodes: CoachGeneration['citedNodes'] = {};
  for (const s of cleaned) {
    for (const id of s.sourceNodeIds) {
      if (citedNodes[id]) continue;
      const n = byId.get(id);
      if (!n) continue;
      citedNodes[id] = {
        title: n.title,
        origin: originOf(n),
        snippet: n.content.slice(0, 160).replace(/\s+/g, ' ').trim(),
      };
    }
  }

  return {
    result: { ...object, suggestions: cleaned },
    meta: { nodesAnalyzed: nodes.length, lookbackDays, generatedAt, droppedCitations },
    citedNodes,
  };
}
