import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import type { EntityInsert, EntityMentionInsert, EntityType } from '@mycortex/db/types';
import { z } from 'zod';
import { meterAi } from '@mycortex/db';

const ExtractedSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(['persona', 'proyecto', 'organizacion', 'lugar', 'tema', 'otro']),
      nodeIds: z.array(z.string()),
    }),
  ),
});

const EXTRACT_SYSTEM = `Eres CORTEX. Extrae las ENTIDADES relevantes del material del usuario: personas, proyectos, organizaciones/empresas, lugares y temas recurrentes. Para cada una devuelve:
- name: el nombre canónico (consistente; si aparece "Going App" y "Going", usa "Going").
- type: persona | proyecto | organizacion | lugar | tema | otro.
- nodeIds: los ids EXACTOS de los nodos donde aparece.

REGLAS: solo entidades con peso real (no menciones triviales). Unifica variantes del mismo nombre en una sola entidad. NO inventes ids. Match el idioma. Devuelve el array "entities" (vacío si no hay nada).`;

type NodeLite = { id: string; title: string | null; content: string; external_source: string | null };

/**
 * Extrae entidades de los nodos recientes y construye el grafo: upsert de
 * entities (unificadas por nombre) + entity_mentions (entity <-> node). Devuelve
 * cuántas entidades y menciones se tocaron.
 *
 * Vive en el package (no en la api) para que lo reusen el endpoint on-demand
 * (`POST /entities/extract`) y el worker programado (`cortex-entities`).
 */
export async function extractEntities(
  db: Db,
  workspaceId: string,
  userId: string,
  opts: { lookbackDays?: number; maxNodes?: number } = {},
): Promise<{ entities: number; mentions: number; failedChunks: number }> {
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
  if (nodes.length === 0) return { entities: 0, mentions: 0, failedChunks: 0 };

  // Por LOTES, no los 80 nodos de un saque.
  //
  // Antes iba en UNA llamada con maxTokens: 4000. El workspace de Ruben (el mas
  // denso) fallo con AI_NoObjectGeneratedError TODOS los dias desde al menos el
  // 13-jul: el modelo intenta emitir las entidades de 80 items, se pasa del tope
  // de salida, el JSON sale cortado y no valida el schema. Se perdia el dia
  // ENTERO de entidades, en silencio — el `errors=2` estaba en los logs y nadie
  // lo miraba. No era culpa del modelo: pasaba igual con Sonnet.
  //
  // Con lotes la salida de cada llamada cabe holgada, y un lote que falle solo
  // se lleva sus 20 nodos en vez de los 80.
  const CHUNK_SIZE = 20;
  const extracted: { name: string; type: string; nodeIds: string[] }[] = [];
  let failedChunks = 0;

  for (let i = 0; i < nodes.length; i += CHUNK_SIZE) {
    const chunk = nodes.slice(i, i + CHUNK_SIZE);
    const prompt =
      `Extrae las entidades de estos ${chunk.length} items.\n\n` +
      chunk
        .map(
          (n) =>
            `===\n[${n.external_source ?? 'nota'}] id=${n.id}\n${n.title ?? ''}\n${n.content
              .slice(0, 350)
              .replace(/\s+/g, ' ')}`,
        )
        .join('\n');
    try {
      const { object, usage } = await generateObject({
        model: models.reasoner,
        schema: ExtractedSchema,
        system: EXTRACT_SYSTEM,
        prompt,
        maxTokens: 4000,
      });
      void meterAi(db, workspaceId, models.reasoner.modelId, usage);
      extracted.push(...object.entities);
    } catch {
      // Un lote perdido no puede tumbar la corrida entera.
      failedChunks++;
    }
  }

  const validIds = new Set(nodes.map((n) => n.id));
  // Unificamos por nombre, mergeando nodeIds validos.
  //
  // La clave IGNORA TILDES a proposito: con `toLowerCase()` a secas, "Ruben
  // Torres" y "Rubén Torres" son claves distintas y Ruben terminaba como dos
  // entidades separadas (19x y 11x) en su propio grafo. Antes se disimulaba
  // porque una sola llamada veia los 80 nodos y el modelo unificaba; con lotes
  // de 20, cada lote solo unifica lo suyo y la deduplicacion determinista pasa
  // a ser la que manda.
  const dedupeKey = (name: string): string =>
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  const merged = new Map<string, { name: string; type: EntityType; nodeIds: Set<string> }>();
  for (const e of extracted) {
    const key = dedupeKey(e.name);
    if (!key) continue;
    const cur = merged.get(key) ?? { name: e.name.trim(), type: e.type as EntityType, nodeIds: new Set<string>() };
    for (const id of e.nodeIds) if (validIds.has(id)) cur.nodeIds.add(id);
    merged.set(key, cur);
  }

  const withMentions = [...merged.values()].filter((e) => e.nodeIds.size > 0);
  if (withMentions.length === 0) return { entities: 0, mentions: 0, failedChunks };

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

  return { entities: entityRows.length, mentions: mentionRows.length, failedChunks };
}
