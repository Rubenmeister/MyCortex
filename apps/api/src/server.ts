import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ingestaModule } from './modules/ingesta/index.js';
import { accionModule } from './modules/accion/index.js';
import { cortexModule } from './modules/cortex/index.js';
import { getEnv } from './lib/env.js';

export async function buildServer(): Promise<FastifyInstance> {
  const env = getEnv();
  const server = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  await server.register(cors, { origin: true });
  await server.register(sensible);

  server.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await server.register(ingestaModule, { prefix: '/ingesta' });
  await server.register(accionModule, { prefix: '/accion' });
  await server.register(cortexModule, { prefix: '/cortex' });

  return server;
}
