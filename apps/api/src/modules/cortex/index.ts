import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { runEvolutionForWorkspace } from '@mycortex/cortex-engine';
import { requireAuth } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import { getEnv } from '../../lib/env.js';

export const cortexModule: FastifyPluginAsync = async (server) => {
  /**
   * Manual evolution trigger for the authenticated user's current workspace.
   * Useful for dev/test and the "Run now" button in the dashboard. Production
   * scheduling lives in the cortex-cron Cloud Run Job.
   */
  server.post('/run', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const env = getEnv();
    const summary = await runEvolutionForWorkspace(getDb(), {
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      hasAnthropicKey: Boolean(env.ANTHROPIC_API_KEY),
      hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    });

    return reply.code(200).send(summary);
  });

  /**
   * List recent nodes for the authenticated user's current workspace.
   * Drives bot /last and the dashboard recent-feed. The DB query filters by
   * workspace_id explicitly; RLS would catch cross-workspace access anyway.
   */
  const ListQuery = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  });
  server.get('/nodes', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    const { data, error } = await auth.db
      .from('nodes')
      .select('id, kind, category, title, content, source, created_at')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });

    return reply.code(200).send({ nodes: data ?? [] });
  });

  /**
   * Digest endpoints. The cortex-digest Cloud Run Job writes rows to
   * daily_digests:
   *   - kind='daily' once every morning  → /digest/today returns latest
   *   - kind='weekly' once every Monday  → /digest/latest-weekly returns latest
   * /list returns recent of any kind.
   */
  server.get('/digest/today', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const { data, error } = await auth.db
      .from('daily_digests')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .eq('kind', 'daily')
      .order('for_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!data) return reply.code(404).send({ error: 'no_digest_yet' });
    return reply.code(200).send({ digest: data });
  });

  server.get('/digest/latest-weekly', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const { data, error } = await auth.db
      .from('daily_digests')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .eq('kind', 'weekly')
      .order('for_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!data) return reply.code(404).send({ error: 'no_digest_yet' });
    return reply.code(200).send({ digest: data });
  });

  server.get('/digest/list', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(30).default(14),
        kind: z.enum(['daily', 'weekly']).optional(),
      })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    let query = auth.db
      .from('daily_digests')
      .select('id, for_date, kind, summary, counts, created_at')
      .eq('workspace_id', auth.workspaceId)
      .order('for_date', { ascending: false })
      .limit(q.data.limit);
    if (q.data.kind) query = query.eq('kind', q.data.kind);
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(200).send({ digests: data ?? [] });
  });
};
