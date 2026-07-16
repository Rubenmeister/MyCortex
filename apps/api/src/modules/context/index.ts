import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { acceptContextProposal, proposeContextUpdates } from '@mycortex/cortex-engine';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { incrementAiOps } from '../../lib/plans.js';

const PutBody = z.object({ body: z.string().max(20000) });
const ListQuery = z.object({
  all: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const IdParams = z.object({ id: z.string().uuid() });

/**
 * Capa 1: el CONTEXTO CURADO ("la constitución") del workspace. El usuario lo
 * edita a mano (GET/PUT /context) y la IA propone hechos estables para fijar
 * (POST /context/propose → bandeja → accept/reject). Al aceptar, se fusiona en
 * el documento que se inyecta en todo razonamiento del LLM.
 */
export const contextModule: FastifyPluginAsync = async (server) => {
  /** El documento curado actual. */
  server.get('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { data, error } = await auth.db
      .from('workspace_context')
      .select('body, updated_at')
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ context: data ?? { body: '', updated_at: null } });
  });

  /** Guardar el documento curado (edición manual del usuario). */
  server.put('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const body = PutBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });

    const { data, error } = await auth.db
      .from('workspace_context')
      .upsert(
        { workspace_id: auth.workspaceId, body: body.data.body, updated_by: auth.userId },
        { onConflict: 'workspace_id' },
      )
      .select('body, updated_at')
      .single();
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ context: data });
  });

  /** Propuestas de contexto (bandeja de seguimiento). Por defecto solo pending. */
  server.get('/proposals', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    let query = auth.db
      .from('context_proposals')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (!q.data.all) query = query.eq('status', 'pending');
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ proposals: data ?? [] });
  });

  /**
   * Corre el LLM sobre el material reciente + el contexto actual y genera
   * propuestas de hechos estables para fijar. Caro (Claude): rate-limit 3/min.
   */
  server.post(
    '/propose',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required' });

      const q = z
        .object({ lookbackDays: z.coerce.number().int().min(1).max(180).optional() })
        .safeParse(req.body ?? {});
      const lookbackDays = q.success ? q.data.lookbackDays : undefined;

      try {
        const { created } = await proposeContextUpdates(auth.db, auth.workspaceId, auth.userId, { lookbackDays });
        void incrementAiOps(auth.workspaceId);
        return reply.code(200).send({ created });
      } catch (err) {
        req.log.error({ err: String(err) }, 'context_propose_failed');
        return reply.code(502).send({ error: 'propose_failed' });
      }
    },
  );

  /** Aceptar una propuesta: la fusiona en el documento y la marca accepted. */
  server.post('/proposals/:id/accept', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    try {
      const res = await acceptContextProposal(auth.db, auth.workspaceId, params.data.id, auth.userId);
      if (!res.ok) return reply.code(404).send({ error: 'proposal_not_found_or_decided' });
      return reply.code(200).send({ ok: true, body: res.body });
    } catch (err) {
      req.log.error({ err: String(err) }, 'context_accept_failed');
      return reply.code(500).send({ error: 'accept_failed' });
    }
  });

  /** Rechazar una propuesta. */
  server.post('/proposals/:id/reject', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { error } = await auth.db
      .from('context_proposals')
      .update({ status: 'rejected', decided_at: new Date().toISOString() })
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ ok: true });
  });
};
