import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { generateExecutiveBriefing } from '@mycortex/cortex-engine';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';

export const bridgeModule: FastifyPluginAsync = async (server) => {
  /** Último briefing ejecutivo de Going. */
  server.get('/briefing', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { data, error } = await auth.db
      .from('executive_briefings')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ briefing: data ?? null });
  });

  /**
   * (Re)genera el briefing a partir de las señales de Going ya ingeridas
   * (nodos external_source='going'). No necesita GitHub. Caro (Claude): 4/min.
   */
  server.post(
    '/briefing/generate',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required' });
      try {
        const out = await generateExecutiveBriefing(auth.db, auth.workspaceId, auth.userId);
        return reply.code(200).send(out);
      } catch (err) {
        req.log.error({ err: String(err) }, 'bridge_briefing_failed');
        return reply.code(502).send({ error: 'briefing_failed' });
      }
    },
  );

  /** Señales recientes de Going (nodos ingeridos por el puente). */
  server.get('/signals', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(40) })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    const { data, error } = await auth.db
      .from('nodes')
      .select('id, title, content, created_at, external_metadata')
      .eq('workspace_id', auth.workspaceId)
      .eq('external_source', 'going')
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ signals: data ?? [] });
  });
};
