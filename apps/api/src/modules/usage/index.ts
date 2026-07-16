import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../lib/auth.js';
import {
  countIntegrations,
  countNodes,
  currentPeriod,
  getAiOps,
  getPlan,
  PLANS,
} from '../../lib/plans.js';

/**
 * Plan y consumo del workspace vs sus límites. Lo usa la UI para mostrar dónde
 * está parado el usuario y explicar por qué se le bloquea algo (402), en vez de
 * un error opaco.
 */
export const usageModule: FastifyPluginAsync = async (server) => {
  server.get('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const plan = await getPlan(auth.db, auth.workspaceId);
    const limits = PLANS[plan];
    const [nodes, integrations, aiOps] = await Promise.all([
      countNodes(auth.db, auth.workspaceId),
      countIntegrations(auth.db, auth.workspaceId),
      getAiOps(auth.db, auth.workspaceId),
    ]);

    return reply.code(200).send({
      plan,
      period: currentPeriod(),
      usage: {
        nodes: { used: nodes, limit: limits.nodes },
        integrations: { used: integrations, limit: limits.integrations },
        // limit null = sin tope (hoy, en todos los planes).
        aiOps: { used: aiOps, limit: limits.aiOpsPerMonth },
      },
      features: {
        cohere: limits.cohere,
        tavily: limits.tavily,
        push: limits.push,
        sharedWorkspaces: limits.sharedWorkspaces,
      },
    });
  });
};
