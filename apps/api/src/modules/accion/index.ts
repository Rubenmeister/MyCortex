import type { FastifyPluginAsync } from 'fastify';

export const accionModule: FastifyPluginAsync = async (server) => {
  server.post('/enrich/:nodeId', async (req, reply) => {
    return reply.code(501).send({ error: 'not_implemented', module: 'accion' });
  });
};
