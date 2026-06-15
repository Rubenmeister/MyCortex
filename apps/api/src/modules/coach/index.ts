import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { generateCoachSuggestions } from './engine.js';

const BodySchema = z.object({
  /** Ventana de material a analizar, en días. */
  lookbackDays: z.coerce.number().int().min(7).max(180).optional(),
});

export const coachModule: FastifyPluginAsync = async (server) => {
  /**
   * Coach de crecimiento personal. Analiza el material del workspace y devuelve
   * sugerencias accionables por dominio (salud, ejercicio, proyectos, etc.).
   *
   * Es el endpoint más caro después de /ask (un razonamiento Claude sobre hasta
   * 80 nodos), así que rate-limit estricto: 6/min por usuario.
   */
  server.post(
    '/suggestions',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;

      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) {
        return reply.code(503).send({ error: 'anthropic_required_for_coach' });
      }

      const body = BodySchema.safeParse(req.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });
      }

      try {
        const out = await generateCoachSuggestions(auth.db, auth.workspaceId, {
          lookbackDays: body.data.lookbackDays,
        });
        return reply.code(200).send(out);
      } catch (err) {
        req.log.error({ err: String(err) }, 'coach_failed');
        return reply.code(502).send({ error: 'coach_generation_failed' });
      }
    },
  );
};
