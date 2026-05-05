import type { FastifyPluginAsync } from 'fastify';
import { runEvolutionForUser } from '@mycortex/cortex-engine';
import { requireAuth } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import { getEnv } from '../../lib/env.js';

export const cortexModule: FastifyPluginAsync = async (server) => {
  /**
   * Manual evolution trigger for the authenticated user. Useful for dev/test
   * and for "Run now" buttons in the dashboard. Production scheduling lives in
   * the cortex-cron Cloud Run Job.
   *
   * Uses the SERVICE-ROLE client because the engine writes to evolution_runs
   * and evolution_actions on the user's behalf — the route still validates
   * the JWT and constrains everything to req.userId.
   */
  server.post('/run', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const env = getEnv();
    const summary = await runEvolutionForUser(getDb(), auth.userId, {
      hasAnthropicKey: Boolean(env.ANTHROPIC_API_KEY),
      hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    });

    return reply.code(200).send(summary);
  });
};
