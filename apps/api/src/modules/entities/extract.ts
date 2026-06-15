import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import type { EntityInsert, EntityMentionInsert, EntityType } from '@mycortex/db/types';
import { z } from 'zod';

const ExtractedSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(['persona', 'proyecto', 'organizacion', 'lugar', 'tema', 'otro']),
      nodeIds: z.array(z.string()),
    }),
  ),
});

const EXTRACT_SYSTEM = `Sos CORTEX. Extraé las ENTIDADES relevantes del material del usuario: personas, proyectos, organizaciones/empresas, lugares y temas recurrentes. Para cada una devolvé:
- name: el nombre canónico (consistente; si aparece "Going App" y "Going", usá "Going").
- type: persona | proyecto | organizacion | lugar | tema | otro.
- nodeIds: los ids EXACTOS de los nodos donde aparece.

REGLAS: solo entidades con peso real (no menciones triviales). Unificá variantes del mismo nombre en una sola entidad. NO inventes ids. Match el idioma. Devolvé el array "entities" (vacío si no hay nada).`;

type NodeLite = { id: string; title: string | null; content: string; external_source: string | null };

/**
 * Extrae entidades de los nodos recientes y construye el grafo: upsert de
 * entities (unificadas por nombre) + entity_mentions (entity <-> node). Devuelve
 * cuántas entidades y menciones se tocaron.
 */
export async function extractEntities(
  db: Db,
  workspaceId: string,
  userId: string,
  opts: { lookbackDays?: number; maxNodes?: number } = {},
): Promise<{ entities: number; mentions: number }> {
  const lookbackDays = opts.lookbackDays ?? 30;
  const maxNodes = opts.maxNodes ?? 80;
  const since = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();

  const { data, error } = await db
    .from('nodes')
    .select('id, title, content, external_source')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(maxNodes);
  if (error) throw new Error(`entities_fetch_failed:${error.message}`);
  const nodes = (data as NodeLite[] | null) ?? [];
  if (nodes.length === 0) return { entities: 0, mentions: 0 };

  const prompt =
    `Extraé las entidades de estos ${nodes.length} ítems.\n\n` +
    nodes
      .map((n) => `===\n[${n.external_source ?? 'nota'}] id=${n.id}\n${n.title ?? ''}\n${n.content.slice(0, 350).replace(/\s+/g, ' ')}`)
      .join('\n');

  const { object } = await generateObject({
    model: models.reasoner,
    schema: ExtractedSchema,
    system: EXTRACT_SYSTEM,
    prompt,
    maxTokens: 4000,
  });

  const validIds = new Set(nodes.map((n) => n.id));
  // Unificamos por nombre (case-insensitive), mergeando nodeIds válidos.
  const merged = new Map<string, { name: string; type: EntityType; nodeIds: Set<string> }>();
  for (const e of object.entities) {
    const key = e.name.trim().toLowerCase();
    if (!key) continue;
    const cur = merged.get(key) ?? { name: e.name.trim(), type: e.type as EntityType, nodeIds: new Set<string>() };
    for (const id of e.nodeIds) if (validIds.has(id)) cur.nodeIds.add(id);
    merged.set(key, cur);
  }

  const withMentions = [...merged.values()].filter((e) => e.nodeIds.size > 0);
  if (withMentions.length === 0) return { entities: 0, mentions: 0 };

  const entityRows: EntityInsert[] = withMentions.map((e) => ({
    workspace_id: workspaceId,
    user_id: userId,
    name: e.name,
    type: e.type,
    last_seen: new Date().toISOString(),
  }));
  const { data: upserted, error: upErr } = await db
    .from('entities')
    .upsert(entityRows, { onConflict: 'workspace_id,name' })
    .select('id, name');
  if (upErr) throw new Error(`entities_upsert_failed:${upErr.message}`);

  const idByName = new Map((upserted ?? []).map((r) => [r.name.toLowerCase(), r.id] as const));

  const mentionRows: EntityMentionInsert[] = [];
  for (const e of withMentions) {
    const eid = idByName.get(e.name.toLowerCase());
    if (!eid) continue;
    for (const nid of e.nodeIds) mentionRows.push({ workspace_id: workspaceId, entity_id: eid, node_id: nid });
  }
  if (mentionRows.length > 0) {
    await db.from('entity_mentions').upsert(mentionRows, { onConflict: 'entity_id,node_id', ignoreDuplicates: true });
  }

  // Recalcular mention_count por entidad tocada.
  for (const eid of new Set(mentionRows.map((m) => m.entity_id))) {
    const { count } = await db
      .from('entity_mentions')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', eid);
    await db.from('entities').update({ mention_count: count ?? 0 }).eq('id', eid);
  }

  return { entities: entityRows.length, mentions: mentionRows.length };
}
