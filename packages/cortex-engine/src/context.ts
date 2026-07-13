import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import type { ContextProposalInsert } from '@mycortex/db/types';
import { z } from 'zod';

// La capa 1 se mantiene chica por diseño: tope de inyección ~2k tokens.
const MAX_CONTEXT_CHARS = 8000;

const SECTIONS = ['Metas', 'Proyectos', 'Personas', 'Reglas y preferencias', 'General'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Bloque autoritativo de contexto curado para inyectar en CADA razonamiento del
 * LLM (coach, chat, ask, agenda, diario). Es lo que el usuario DECLARA — manda
 * sobre lo que la IA infiere. Vacío si no hay contexto todavía.
 */
export async function buildContextBlock(db: Db, workspaceId: string): Promise<string> {
  const { data } = await db
    .from('workspace_context')
    .select('body')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const body = (data?.body ?? '').trim();
  if (!body) return '';
  const clipped = body.length > MAX_CONTEXT_CHARS ? `${body.slice(0, MAX_CONTEXT_CHARS)}\n…(contexto truncado)` : body;
  return (
    `CONTEXTO DECLARADO POR EL USUARIO (fuente de verdad — lo que el usuario afirma sobre su vida y trabajo). ` +
    `Respétalo siempre; si algo que infieres del material lo contradice, GANA esto:\n${clipped}\n\n`
  );
}

// --- Propuestas de la IA (loop bidireccional) ----------------------------

const ProposalSchema = z.object({
  proposals: z.array(
    z.object({
      section: z.enum(SECTIONS),
      text: z.string().min(1),
      rationale: z.string().optional(),
      nodeIds: z.array(z.string()),
    }),
  ),
});

const PROPOSE_SYSTEM = `Eres CORTEX. Propón HECHOS ESTABLES para el CONTEXTO curado del usuario: cosas DURADERAS sobre su vida y trabajo que valga la pena FIJAR de forma permanente — metas, proyectos activos, personas clave, reglas y preferencias.

REGLAS:
- NO propongas tareas, eventos puntuales ni cosas efímeras (eso va a otro lado).
- Cada hecho: declarativo, atemporal, 1-2 líneas. Cita en nodeIds los nodos que lo sustentan.
- Si el CONTEXTO ACTUAL o los HECHOS YA PROPUESTOS de abajo ya cubren algo, NO lo repitas.
- Español neutro de Ecuador ("tú", nunca voseo).
- Devuelve "proposals" (vacío si no hay nada nuevo que fijar).`;

type NodeLite = { id: string; title: string | null; content: string; external_source: string | null };

/**
 * Corre el LLM sobre el material reciente + el contexto actual y propone hechos
 * estables para fijar en la constitución. Dedup contra el contexto y contra
 * propuestas previas. Persiste como context_proposals (pending). Idempotente.
 */
export async function proposeContextUpdates(
  db: Db,
  workspaceId: string,
  userId: string,
  opts: { lookbackDays?: number; maxNodes?: number } = {},
): Promise<{ created: number }> {
  const lookbackDays = opts.lookbackDays ?? 30;
  const maxNodes = opts.maxNodes ?? 60;
  const since = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();

  const { data: nodeData, error } = await db
    .from('nodes')
    .select('id, title, content, external_source')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(maxNodes);
  if (error) throw new Error(`context_fetch_failed:${error.message}`);
  const nodes = (nodeData as NodeLite[] | null) ?? [];
  if (nodes.length === 0) return { created: 0 };

  const { data: ctx } = await db
    .from('workspace_context')
    .select('body')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const currentBody = (ctx?.body ?? '').trim();

  // Hechos ya propuestos (cualquier estado) para no re-proponerlos.
  const { data: existing } = await db
    .from('context_proposals')
    .select('text')
    .eq('workspace_id', workspaceId);
  const seen = new Set((existing ?? []).map((r) => normalize(r.text)));

  const prompt =
    `CONTEXTO ACTUAL del usuario:\n${currentBody || '(vacío)'}\n\n` +
    (seen.size > 0 ? `HECHOS YA PROPUESTOS (no repetir):\n${[...seen].slice(0, 60).join('\n')}\n\n` : '') +
    `Material reciente (${nodes.length} ítems):\n` +
    nodes
      .map((n) => `===\n[${n.external_source ?? 'nota'}] id=${n.id}\n${n.title ?? ''}\n${n.content.slice(0, 350).replace(/\s+/g, ' ')}`)
      .join('\n');

  const { object } = await generateObject({
    model: models.reasoner,
    schema: ProposalSchema,
    system: PROPOSE_SYSTEM,
    prompt,
    maxTokens: 2500,
  });

  const validIds = new Set(nodes.map((n) => n.id));
  const bodyLower = currentBody.toLowerCase();
  const rows: ContextProposalInsert[] = [];
  const batchSeen = new Set<string>();
  for (const p of object.proposals) {
    const text = p.text.trim();
    const key = normalize(text);
    if (!text || seen.has(key) || batchSeen.has(key)) continue;
    // Si el cuerpo ya menciona el hecho casi literal, saltar.
    if (bodyLower.includes(text.toLowerCase())) continue;
    batchSeen.add(key);
    rows.push({
      workspace_id: workspaceId,
      user_id: userId,
      section: p.section,
      text,
      rationale: p.rationale ?? null,
      source_node_ids: p.nodeIds.filter((id) => validIds.has(id)),
    });
  }
  if (rows.length === 0) return { created: 0 };

  // Insert best-effort por fila (el índice único (workspace,lower(text)) es el
  // backstop contra carreras; una violación no debe tumbar el resto).
  let created = 0;
  for (const row of rows) {
    const { error: insErr } = await db.from('context_proposals').insert(row);
    if (!insErr) created++;
  }
  return { created };
}

/**
 * Acepta una propuesta: la fusiona en el documento curado (bajo su sección) y la
 * marca accepted. Es lo que cierra el loop "la IA propone → tú apruebas → queda".
 */
export async function acceptContextProposal(
  db: Db,
  workspaceId: string,
  proposalId: string,
  updatedBy: string,
): Promise<{ ok: boolean; body?: string }> {
  const { data: prop } = await db
    .from('context_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!prop || prop.status !== 'pending') return { ok: false };

  const { data: ctx } = await db
    .from('workspace_context')
    .select('body')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const body = ctx?.body ?? '';

  const merged = mergeIntoSection(body, (prop.section as Section) || 'General', prop.text);

  const { error: upErr } = await db
    .from('workspace_context')
    .upsert({ workspace_id: workspaceId, body: merged, updated_by: updatedBy }, { onConflict: 'workspace_id' });
  if (upErr) throw new Error(`context_upsert_failed:${upErr.message}`);

  await db
    .from('context_proposals')
    .update({ status: 'accepted', decided_at: new Date().toISOString() })
    .eq('id', proposalId)
    .eq('workspace_id', workspaceId);

  return { ok: true, body: merged };
}

/** Inserta `- text` bajo `## section`, creando la sección si no existe. */
export function mergeIntoSection(body: string, section: string, text: string): string {
  const bullet = `- ${text.trim()}`;
  const header = `## ${section}`;
  const lines = body.split('\n');
  const headerIdx = lines.findIndex((l) => l.trim().toLowerCase() === header.toLowerCase());

  if (headerIdx === -1) {
    const prefix = body.trim() ? `${body.trimEnd()}\n\n` : '';
    return `${prefix}${header}\n${bullet}\n`;
  }
  // Insertar al final de la sección (antes del próximo '## ' o al final).
  let insertAt = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').startsWith('## ')) {
      insertAt = i;
      break;
    }
  }
  // Retroceder sobre líneas en blanco al final de la sección.
  while (insertAt > headerIdx + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
  lines.splice(insertAt, 0, bullet);
  return lines.join('\n');
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
