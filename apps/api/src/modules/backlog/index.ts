import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../lib/auth.js';
import { reviewEmailBacklog } from '@mycortex/cortex-engine';

/**
 * Revisión del backlog de correo: las conversaciones humanas sin responder.
 *
 * Es on-demand (no worker): el usuario pulsa "Revisar mi bandeja" y ve, en el
 * momento, las conversaciones que murieron sin respuesta suya. Pieza central del
 * onboarding — el "aha" del primer día.
 *
 * Cuesta LLM (Haiku, por lotes), así que va detrás de auth y con un rate-limit
 * más estricto que el resto: no es un endpoint para spamear.
 */
export const backlogModule: FastifyPluginAsync = async (server) => {
  server.get(
    '/review',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      try {
        const result = await reviewEmailBacklog(auth.db, auth.workspaceId, { lookbackDays: 120 });
        return reply.code(200).send(result);
      } catch (err) {
        req.log.error({ err: String(err) }, 'backlog_review_failed');
        return reply.code(502).send({ error: 'backlog_review_failed' });
      }
    },
  );
};
