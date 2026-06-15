import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { generateExecutiveBriefing } from '@mycortex/cortex-engine';
import type { BridgeSourceInsert } from '@mycortex/db/types';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export const bridgeModule: FastifyPluginAsync = async (server) => {
  /** Último briefing ejecutivo de Going. */
  server.get('/briefing', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { data, error } = await auth.db
      .from('executive_briefings')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ briefing: data ?? null });
  });

  /**
   * (Re)genera el briefing a partir de las señales de Going ya ingeridas
   * (nodos external_source='going'). No necesita GitHub. Caro (Claude): 4/min.
   */
  server.post(
    '/briefing/generate',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required' });
      try {
        const out = await generateExecutiveBriefing(auth.db, auth.workspaceId, auth.userId);
        return reply.code(200).send(out);
      } catch (err) {
        req.log.error({ err: String(err) }, 'bridge_briefing_failed');
        return reply.code(502).send({ error: 'briefing_failed' });
      }
    },
  );

  /** Señales recientes de Going (nodos ingeridos por el puente). */
  server.get('/signals', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(40) })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    const { data, error } = await auth.db
      .from('nodes')
      .select('id, title, content, created_at, external_metadata')
      .eq('workspace_id', auth.workspaceId)
      .eq('external_source', 'going')
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ signals: data ?? [] });
  });

  // ---- Fuentes por workspace (multi-tenant) -----------------------------

  /** Fuentes de negocio del workspace. NUNCA devolvemos el token (solo has_token). */
  server.get('/sources', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { data, error } = await auth.db
      .from('bridge_sources')
      .select('id, provider, repo, status, last_synced_at, last_error, created_at, access_token')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: 'db_error' });
    const sources = (data ?? []).map((s) => {
      const { access_token, ...rest } = s;
      return { ...rest, has_token: Boolean(access_token) };
    });
    return reply.code(200).send({ sources });
  });

  /** Conectar una fuente (repo de GitHub) al workspace. */
  server.post('/sources', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const body = z
      .object({
        repo: z.string().trim().regex(REPO_RE, 'repo debe ser "owner/repo"'),
        accessToken: z.string().trim().min(1).max(255).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });

    const insert: BridgeSourceInsert = {
      workspace_id: auth.workspaceId,
      user_id: auth.userId,
      provider: 'github',
      repo: body.data.repo,
      access_token: body.data.accessToken ?? null,
    };
    const { data, error } = await auth.db
      .from('bridge_sources')
      .insert(insert)
      .select('id, provider, repo, status, created_at')
      .single();
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'source_already_exists' });
      return reply.code(500).send({ error: 'db_error' });
    }
    return reply.code(201).send({ source: data });
  });

  /** Desconectar una fuente. */
  server.delete('/sources/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const { error } = await auth.db
      .from('bridge_sources')
      .delete()
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ ok: true });
  });
};
