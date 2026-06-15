import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { deriveUserProfile, generateCoachSuggestions, persistCoachGeneration } from '@mycortex/cortex-engine';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';

const GenerateBody = z.object({
  lookbackDays: z.coerce.number().int().min(7).max(180).optional(),
  /** Si true, persiste la generación (coach_runs + coach_suggestions). */
  save: z.boolean().optional(),
});

const ListQuery = z.object({
  all: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ActionParams = z.object({ id: z.string().uuid() });
const ActionBody = z.object({
  action: z.enum(['done', 'dismiss', 'snooze', 'reopen']),
  /** Para snooze: días a posponer (default 7). */
  days: z.coerce.number().int().min(1).max(60).optional(),
});

export const coachModule: FastifyPluginAsync = async (server) => {
  /**
   * Genera el coaching on-demand. Endpoint caro (Claude sobre hasta 80 nodos):
   * rate-limit 6/min. Con `save:true` además lo persiste para el seguimiento.
   */
  server.post(
    '/suggestions',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;

      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required_for_coach' });

      const body = GenerateBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });

      try {
        const out = await generateCoachSuggestions(auth.db, auth.workspaceId, {
          lookbackDays: body.data.lookbackDays,
        });
        let saved: { runId: string | null; inserted: number } | undefined;
        if (body.data.save) {
          saved = await persistCoachGeneration(auth.db, auth.workspaceId, auth.userId, out);
        }
        return reply.code(200).send({ ...out, ...(saved ? { saved } : {}) });
      } catch (err) {
        req.log.error({ err: String(err) }, 'coach_failed');
        return reply.code(502).send({ error: 'coach_generation_failed' });
      }
    },
  );

  /**
   * Sugerencias persistidas (las que generó el worker proactivo o un save).
   * Por defecto solo las 'pending'; ?all=1 trae todo el historial.
   */
  server.get('/suggestions/list', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    let query = auth.db
      .from('coach_suggestions')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (!q.data.all) query = query.eq('status', 'pending');
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ suggestions: data ?? [] });
  });

  /**
   * Ciclo de vida de una sugerencia (el corazón del SEGUIMIENTO):
   *   done    → la hiciste
   *   dismiss → no aplica
   *   snooze  → recordámela más adelante
   *   reopen  → volver a pendiente
   */
  server.post('/suggestions/:id/action', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = ActionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = ActionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_action' });

    const now = new Date().toISOString();
    const update: {
      status: 'pending' | 'done' | 'dismissed' | 'snoozed';
      read_at?: string;
      done_at?: string | null;
      dismissed_at?: string | null;
      snoozed_until?: string | null;
    } = { status: 'pending' };
    switch (body.data.action) {
      case 'done':
        update.status = 'done';
        update.done_at = now;
        update.read_at = now;
        break;
      case 'dismiss':
        update.status = 'dismissed';
        update.dismissed_at = now;
        update.read_at = now;
        break;
      case 'snooze':
        update.status = 'snoozed';
        update.snoozed_until = new Date(Date.now() + (body.data.days ?? 7) * 24 * 3600_000).toISOString();
        update.read_at = now;
        break;
      case 'reopen':
        update.status = 'pending';
        update.done_at = null;
        update.dismissed_at = null;
        update.snoozed_until = null;
        break;
    }

    const { error } = await auth.db
      .from('coach_suggestions')
      .update(update)
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ ok: true });
  });

  /** El perfil que el coach aprendió del usuario ("lo que sé de vos"). */
  server.get('/profile', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { data, error } = await auth.db
      .from('coach_profile')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ profile: data ?? null });
  });

  /**
   * (Re)deriva el perfil analizando el corpus. Caro (Claude sobre hasta 120
   * nodos): rate-limit 3/min.
   */
  server.post(
    '/profile/refresh',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required_for_coach' });
      try {
        const profile = await deriveUserProfile(auth.db, auth.workspaceId, auth.userId);
        return reply.code(200).send({ profile });
      } catch (err) {
        req.log.error({ err: String(err) }, 'coach_profile_refresh_failed');
        return reply.code(502).send({ error: 'profile_refresh_failed' });
      }
    },
  );
};
