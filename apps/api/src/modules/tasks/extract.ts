import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import type { TaskPriority } from '@mycortex/db/types';
import { z } from 'zod';

// Schema permisivo (sin .max()/.uuid() estrictos — ver lección en coach).
const ExtractedSchema = z.object({
  items: z.array(
    z.object({
      title: z.string().min(1),
      detail: z.string().nullable(),
      priority: z.enum(['alta', 'media', 'baja']),
      sourceNodeId: z.string(),
    }),
  ),
});

export type ExtractedItem = {
  title: string;
  detail: string | null;
  priority: TaskPriority;
  sourceNodeId: string | null;
};

const EXTRACT_SYSTEM = `Sos CORTEX. Extraé TAREAS ACCIONABLES del material reciente del usuario (notas, mails, eventos). Una tarea accionable es algo concreto que el usuario tiene que HACER.

Para cada ítem real devolvé: title (imperativo, 1 línea: "Responder a X sobre Y"), detail (contexto breve o null), priority (alta/media/baja según urgencia e impacto), sourceNodeId (el id EXACTO del nodo de donde la sacaste).

REGLAS:
- Solo cosas que requieran acción del usuario. NO incluyas: FYI, newsletters, confirmaciones de pagos hechos, OTPs, status normales.
- NO inventes tareas que no estén respaldadas por el material.
- Si un nodo no tiene nada accionable, no devuelvas nada para él.
- Match el idioma del material (probablemente español). Devolvé el array "items" (vacío si no hay nada accionable).`;

type NodeLite = {
  id: string;
  title: string | null;
  content: string;
  external_source: string | null;
  created_at: string;
};

/**
 * Extrae action items de los nodos recientes del workspace. Devuelve ítems
 * validados (descarta sourceNodeId inventados). NO inserta — la ruta decide.
 */
export async function extractActionItems(
  db: Db,
  workspaceId: string,
  opts: { lookbackDays?: number; maxNodes?: number } = {},
): Promise<ExtractedItem[]> {
  const lookbackDays = opts.lookbackDays ?? 7;
  const maxNodes = opts.maxNodes ?? 60;
  const since = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();

  const { data, error } = await db
    .from('nodes')
    .select('id, title, content, external_source, created_at')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(maxNodes);
  if (error) throw new Error(`tasks_fetch_failed:${error.message}`);

  const nodes = (data as NodeLite[] | null) ?? [];
  if (nodes.length === 0) return [];

  const prompt =
    `Extraé las tareas accionables de estos ${nodes.length} ítems recientes.\n\n` +
    nodes
      .map(
        (n) =>
          `===\n[${n.external_source ?? 'nota'}] id=${n.id}\nTítulo: ${n.title ?? '(sin título)'}\n${n.content.slice(0, 400).replace(/\s+/g, ' ')}`,
      )
      .join('\n');

  const { object } = await generateObject({
    model: models.reasoner,
    schema: ExtractedSchema,
    system: EXTRACT_SYSTEM,
    prompt,
    maxTokens: 4000,
  });

  const validIds = new Set(nodes.map((n) => n.id));
  return object.items.map((it) => ({
    title: it.title,
    detail: it.detail,
    priority: it.priority as TaskPriority,
    sourceNodeId: validIds.has(it.sourceNodeId) ? it.sourceNodeId : null,
  }));
}
