import type { FastifyPluginAsync } from 'fastify';

export const ingestaModule: FastifyPluginAsync = async (server) => {
  server.post('/', async (req, reply) => {
    return reply.code(501).send({ error: 'not_implemented', module: 'ingesta' });
  });
};
