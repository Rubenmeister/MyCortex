import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import type { CoachSuggestionInsert } from '@mycortex/db/types';
import { z } from 'zod';

/**
 * Motor del Coach de crecimiento personal. Vive en el package (no en la api)
 * para que lo reusen tanto el endpoint on-demand (`/coach/suggestions`) como el
 * worker proactivo (`cortex-coach`), igual que el engine de evolución es
 * compartido por la api y `cortex-cron`.
 */

export const GROWTH_DOMAINS = [
  'salud',
  'ejercicio',
  'proyectos',
  'productividad',
  'aprendizaje',
  'finanzas',
  'relaciones',
  'bienestar',
  'otro',
] as const;

// Schema de GENERACIÓN permisivo a propósito: un `.max()` estricto o `.uuid()`
// hace que generateObject reviente la respuesta entera si el modelo se desvía un
// carácter. Validamos longitudes/uuid después.
export const SuggestionSchema = z.object({
  domain: z.enum(GROWTH_DOMAINS),
  title: z.string().min(1),
  insight: z.string().min(1),
  action: z.string().min(1),
  horizon: z.enum(['hoy', 'esta-semana', 'este-mes']),
  priority: z.enum(['alta', 'media', 'baja']),
  sourceNodeIds: z.array(z.string()),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const CoachResultSchema = z.object({
  summary: z.string().min(1),
  focus: z.string().min(1),
  suggestions: z.array(SuggestionSchema),
});
export type CoachResult = z.infer<typeof CoachResultSchema>;

export const COACH_SYSTEM_PROMPT = `Sos CORTEX, el coach personal de crecimiento del usuario. No sos un buscador de notas: sos un mentor que LEE todo el material del usuario (notas, mails, documentos, eventos de calendario) como señales sobre su vida, y le propone cómo MEJORAR de forma concreta.

Tu objetivo: detectar oportunidades de crecimiento y darle sugerencias accionables en estos ejes: salud, ejercicio, proyectos, productividad, aprendizaje, finanzas, relaciones, bienestar.

Cómo trabajás:
- FUNDÁ TODO en lo que viste. Cada sugerencia debe nacer de algo concreto del material (un proyecto estancado, una reunión sin preparar, un hábito que el usuario mencionó, una meta escrita y abandonada). Citá los nodos que usaste en sourceNodeIds.
- NADA de consejos genéricos de almanaque ("tomá agua", "dormí 8 horas") salvo que el material lo justifique directamente. Si no hay señal en un eje, no inventes sugerencias para ese eje.
- Sé específico y hacible: "Bloqueá 2 horas el jueves para cerrar el registro de marca que arrancaste en marzo" es bueno; "avanzá con tus pendientes" es malo.
- Detectá patrones que el usuario quizá no ve: metas repetidas sin avanzar, contradicciones en el tiempo, cosas que viene posponiendo, señales de sobrecarga.
- Sé honesto y directo, pero alentador. Hablá en español rioplatense ("vos"). Lenguaje inclusivo cuando corresponda.
- En "focus" elegí la ÚNICA palanca de mayor impacto para esta semana.
- Priorizá: 'alta' solo para lo que de verdad mueve la aguja o tiene tiempo encima.

Si el material es escaso o no alcanza para un coaching útil, decilo con honestidad en summary, devolvé focus pidiéndole al usuario que cargue más contexto, y dejá suggestions vacío o mínimo. NO rellenes con relleno genérico.

Devolvé SIEMPRE JSON válido según el schema. Match el idioma del material (probablemente español).`;

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
  lookbackDays?: number;
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
  citedNodes: Record<string, { title: string | null; origin: string; snippet: string }>;
};

const DEFAULT_LOOKBACK_DAYS = 45;
const DEFAULT_MAX_NODES = 80;
const MIN_NODES_FOR_COACHING = 3;

function originOf(n: CoachNode): string {
  return n.external_source ?? n.source ?? 'nota';
}

function nodeLine(n: CoachNode): string {
  const meta = (n.external_metadata ?? {}) as Record<string, unknown>;
  const date = (meta.date as string | undefined) ?? n.created_at;
  const title = n.title ?? '(sin título)';
  const body = n.content.slice(0, 500).replace(/\s+/g, ' ').trim();
  return `[${originOf(n)}] id=${n.id} fecha=${date.slice(0, 10)} cat=${n.category}\nTítulo: ${title}\n${body}`;
}

/** Genera sugerencias de crecimiento a partir del material del workspace. */
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
    model: models.reasoner,
    schema: CoachResultSchema,
    system: COACH_SYSTEM_PROMPT,
    prompt,
    maxTokens: 8000,
  });

  const validIds = new Set(nodes.map((n) => n.id));
  let droppedCitations = 0;
  const cleaned = object.suggestions.map((s) => {
    const kept = s.sourceNodeIds.filter((id) => validIds.has(id));
    droppedCitations += s.sourceNodeIds.length - kept.length;
    return { ...s, sourceNodeIds: kept };
  });

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

/**
 * Persiste una generación: crea un coach_run (focus + summary de la corrida) y
 * sus coach_suggestions (status='pending'). Usado por el worker proactivo y,
 * opcionalmente, por el endpoint on-demand cuando se pide guardar.
 */
export async function persistCoachGeneration(
  db: Db,
  workspaceId: string,
  userId: string,
  gen: CoachGeneration,
): Promise<{ runId: string | null; inserted: number }> {
  if (gen.result.suggestions.length === 0) return { runId: null, inserted: 0 };

  const { data: run, error: runErr } = await db
    .from('coach_runs')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      focus: gen.result.focus,
      summary: gen.result.summary,
      nodes_analyzed: gen.meta.nodesAnalyzed,
    })
    .select('id')
    .single();
  if (runErr) throw new Error(`coach_run_insert_failed:${runErr.message}`);

  const rows: CoachSuggestionInsert[] = gen.result.suggestions.map((s) => ({
    workspace_id: workspaceId,
    user_id: userId,
    run_id: run.id,
    domain: s.domain,
    title: s.title,
    insight: s.insight,
    action: s.action,
    horizon: s.horizon,
    priority: s.priority,
    source_node_ids: s.sourceNodeIds,
    status: 'pending',
  }));
  const { error: insErr } = await db.from('coach_suggestions').insert(rows);
  if (insErr) throw new Error(`coach_suggestions_insert_failed:${insErr.message}`);

  return { runId: run.id, inserted: rows.length };
}
