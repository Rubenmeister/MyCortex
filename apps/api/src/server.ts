import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { Sentry } from './lib/sentry.js';
import { ingestaModule } from './modules/ingesta/index.js';
import { accionModule } from './modules/accion/index.js';
import { cortexModule } from './modules/cortex/index.js';
import { coachModule } from './modules/coach/index.js';
import { agendaModule } from './modules/agenda/index.js';
import { tasksModule } from './modules/tasks/index.js';
import { entitiesModule } from './modules/entities/index.js';
import { contextModule } from './modules/context/index.js';
import { usageModule } from './modules/usage/index.js';
import { bridgeModule } from './modules/bridge/index.js';
import { askModule } from './modules/ask/index.js';
import { workspacesModule } from './modules/workspaces/index.js';
import { integrationsModule } from './modules/integrations/index.js';
import { invitationsModule } from './modules/invitations/index.js';
import { whatsappModule } from './modules/whatsapp/index.js';
import { getEnv } from './lib/env.js';
import { QuotaError } from './lib/plans.js';

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
    // 10 MB so /ingesta/audio can accept ~5 min of OGG/M4A at base64 inflation.
    bodyLimit: 10 * 1024 * 1024,
    // Confiar en el X-Forwarded-For que Cloud Run inyecta, así rate-limit
    // keyea por la IP real del cliente y no por la IP del proxy interno.
    trustProxy: true,
  });

  await server.register(cors, { origin: true });
  await server.register(sensible);

  // Rate limit global — protege contra abuse / scrapers / bots accidentales.
  // Pensar como "uso humano legítimo generoso". Endpoints específicamente
  // caros (LLM en /ask, transcripción en /ingesta/audio) tienen overrides
  // más estrictos en sus módulos vía `config: { rateLimit: { max, timeWindow } }`.
  //
  // Excepciones: /health (uptime) y /webhooks/whatsapp (Meta burstea) usan
  // `config: { rateLimit: false }` para skip total.
  await server.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    skipOnError: true,
    keyGenerator: (req) => {
      // Por token JWT prefix si está autenticado, sino por IP. Evita que
      // un user con NAT compartido (oficina, café) consuma el cupo de
      // todos los compañeros que comparten esa IP.
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        return `bearer:${auth.slice(7, 27)}`;
      }
      return req.ip;
    },
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Has hecho demasiadas peticiones. Esperá ${Math.ceil(ctx.ttl / 1000)} segundos antes de volver a intentar.`,
    }),
  });

  // /health: skip rate limit completamente — Cloud Run + GCP uptime checks
  // pueden pegar muy seguido y no quiero que se sumen al budget del user.
  server.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  // Sentry error handler — captura cualquier error que llegue al boundary
  // de Fastify (incluye errores no-manejados de handlers). Pre-filtramos
  // 4xx en beforeSend() de sentry.ts para no enviarlos.
  server.setErrorHandler((err: unknown, request, reply) => {
    // Cuota agotada → 402 con el detalle, para que la UI sepa qué límite se
    // tocó y ofrezca subir de plan. Se maneja aquí (y no en cada ruta) para
    // que cualquier `throw new QuotaError(...)` quede cubierto.
    if (err instanceof QuotaError) {
      request.log.info({ code: err.code, ...err.detail }, 'quota_exceeded');
      return reply.code(402).send({ error: err.code, ...err.detail });
    }
    // Normalize: handler de Fastify recibe `unknown` en strict mode.
    const e = err as { statusCode?: number; name?: string; message?: string };
    const code = e.statusCode ?? 500;
    if (code >= 500) {
      Sentry.captureException(err, {
        contexts: {
          request: {
            method: request.method,
            url: request.url,
            // No incluimos body — puede tener PII / tokens.
          },
        },
      });
    }
    request.log.error({ err, statusCode: code }, 'request_error');
    void reply.code(code).send({
      error: e.name ?? 'InternalError',
      message: code >= 500 ? 'Algo se rompió de nuestro lado. Ya lo reportamos.' : (e.message ?? 'Error'),
    });
  });

  await server.register(ingestaModule, { prefix: '/ingesta' });
  await server.register(accionModule, { prefix: '/accion' });
  await server.register(cortexModule, { prefix: '/cortex' });
  await server.register(coachModule, { prefix: '/coach' });
  await server.register(agendaModule, { prefix: '/agenda' });
  await server.register(tasksModule, { prefix: '/tasks' });
  await server.register(entitiesModule, { prefix: '/entities' });
  await server.register(contextModule, { prefix: '/context' });
  await server.register(usageModule, { prefix: '/usage' });
  await server.register(bridgeModule, { prefix: '/bridge' });
  await server.register(askModule, { prefix: '/ask' });
  await server.register(workspacesModule, { prefix: '/workspaces' });
  await server.register(integrationsModule, { prefix: '/integrations' });
  await server.register(invitationsModule, { prefix: '/invitations' });
  // WhatsApp module registers its own /webhooks/whatsapp + /integrations/whatsapp/*
  // routes so it owns the path namespace (Meta expects /webhooks/whatsapp).
  await server.register(whatsappModule);

  return server;
}
