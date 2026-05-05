import type { FastifyPluginAsync } from 'fastify';

export const cortexModule: FastifyPluginAsync = async (server) => {
  server.get('/nodes/:userId', async (req, reply) => {
    return reply.code(501).send({ error: 'not_implemented', module: 'cortex' });
  });
};
