import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { buildMeetingPrep, getUpcomingEvents } from './engine.js';

const UpcomingQuery = z.object({
  days: z.coerce.number().int().min(1).max(60).default(7),
});

const PrepBody = z.object({
  eventNodeId: z.string().uuid(),
});

export const agendaModule: FastifyPluginAsync = async (server) => {
  /** Eventos próximos del workspace (derivados de los nodos de calendario). */
  server.get('/upcoming', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = UpcomingQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    try {
      const events = await getUpcomingEvents(auth.db, auth.workspaceId, { days: q.data.days });
      return reply.code(200).send({ events });
    } catch (err) {
      req.log.error({ err: String(err) }, 'agenda_upcoming_failed');
      return reply.code(500).send({ error: 'agenda_failed' });
    }
  });

  /**
   * Brief de preparación para un evento. Caro (embed + hybrid search + Claude),
   * así que rate-limit estricto: 10/min por usuario.
   */
  server.post(
    '/prep',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;

      const env = getEnv();
      if (!env.OPENAI_API_KEY) return reply.code(503).send({ error: 'openai_required_for_prep' });

      const body = PrepBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });

      try {
        const prep = await buildMeetingPrep(auth.db, auth.workspaceId, body.data.eventNodeId, {
          OPENAI_API_KEY: env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
          COHERE_API_KEY: env.COHERE_API_KEY,
        });
        return reply.code(200).send(prep);
      } catch (err) {
        const msg = String(err);
        if (msg.includes('event_not_found')) return reply.code(404).send({ error: 'event_not_found' });
        req.log.error({ err: msg }, 'agenda_prep_failed');
        return reply.code(502).send({ error: 'prep_failed' });
      }
    },
  );
};
