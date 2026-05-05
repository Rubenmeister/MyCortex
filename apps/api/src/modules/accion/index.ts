import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth.js';
import { enrichNode } from './enricher.js';

const ParamsSchema = z.object({ nodeId: z.string().uuid() });

export const accionModule: FastifyPluginAsync = async (server) => {
  server.post('/enrich/:nodeId', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_node_id' });
    }

    const outcome = await enrichNode(params.data.nodeId, auth.jwt);
    const failed = outcome.errors.length > 0 && !outcome.embedded && !outcome.searched;
    return reply.code(failed ? 422 : 200).send(outcome);
  });
};
