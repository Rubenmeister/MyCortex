import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { extractEntities } from '@mycortex/cortex-engine';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { incrementAiOps } from '../../lib/plans.js';

const ListQuery = z.object({
  type: z.enum(['persona', 'proyecto', 'organizacion', 'lugar', 'tema', 'otro']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const IdParams = z.object({ id: z.string().uuid() });

export const entitiesModule: FastifyPluginAsync = async (server) => {
  /** Lista de entidades del workspace, por relevancia (menciones). */
  server.get('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    let query = auth.db
      .from('entities')
      .select('id, name, type, summary, mention_count, last_seen')
      .eq('workspace_id', auth.workspaceId)
      .order('mention_count', { ascending: false })
      .limit(q.data.limit);
    if (q.data.type) query = query.eq('type', q.data.type);
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ entities: data ?? [] });
  });

  /** "Mostrame todo sobre X": la entidad + sus nodos + entidades relacionadas. */
  server.get('/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { data: entity, error: entErr } = await auth.db
      .from('entities')
      .select('*')
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (entErr) return reply.code(500).send({ error: 'db_error' });
    if (!entity) return reply.code(404).send({ error: 'entity_not_found' });

    const { data: mentions } = await auth.db
      .from('entity_mentions')
      .select('node_id')
      .eq('entity_id', params.data.id);
    const nodeIds = (mentions ?? []).map((m) => m.node_id);

    let nodes: unknown[] = [];
    let related: Array<{ id: string; name: string; type: string; count: number }> = [];
    if (nodeIds.length > 0) {
      const { data: nodeRows } = await auth.db
        .from('nodes')
        .select('id, title, content, source, external_source, created_at')
        .in('id', nodeIds)
        .order('created_at', { ascending: false })
        .limit(50);
      nodes = nodeRows ?? [];

      // Entidades relacionadas por co-ocurrencia en los mismos nodos.
      const { data: co } = await auth.db
        .from('entity_mentions')
        .select('entity_id')
        .in('node_id', nodeIds)
        .neq('entity_id', params.data.id);
      const counts = new Map<string, number>();
      for (const row of co ?? []) counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1);
      const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
      if (topIds.length > 0) {
        const { data: relRows } = await auth.db
          .from('entities')
          .select('id, name, type')
          .in('id', topIds);
        related = (relRows ?? []).map((r) => ({ ...r, count: counts.get(r.id) ?? 0 })).sort((a, b) => b.count - a.count);
      }
    }

    return reply.code(200).send({ entity, nodes, related });
  });

  /**
   * Construye/actualiza el grafo extrayendo entidades del material reciente.
   * Caro (Claude sobre hasta 80 nodos): rate-limit 3/min.
   */
  server.post(
    '/extract',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required' });

      const body = z
        .object({ lookbackDays: z.coerce.number().int().min(1).max(180).optional() })
        .safeParse(req.body ?? {});
      const lookbackDays = body.success ? body.data.lookbackDays : undefined;

      try {
        const result = await extractEntities(auth.db, auth.workspaceId, auth.userId, { lookbackDays });
        void incrementAiOps(auth.workspaceId);
        return reply.code(200).send(result);
      } catch (err) {
        req.log.error({ err: String(err) }, 'entities_extract_failed');
        return reply.code(502).send({ error: 'extract_failed' });
      }
    },
  );
};
