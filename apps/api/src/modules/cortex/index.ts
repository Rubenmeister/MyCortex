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

  /**
   * Smart alerts: real-time urgency items detected by the cortex-alerts
   * worker. The list endpoint returns OPEN alerts (not dismissed, not
   * acted on) by default; pass ?all=1 for everything including resolved.
   * Mark endpoints update the timestamp columns to track lifecycle.
   */
  server.get('/alerts', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = z
      .object({
        all: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    // Traemos la fecha propia del nodo origen: `created_at` de la alerta es
    // cuándo la generamos, NO cuándo pasó el hecho. Tras un backfill de Gmail
    // divergen meses (un correo del 5-may alertado el 16-jul se veía "16 jul").
    let query = auth.db
      .from('smart_alerts')
      .select('*, nodes(external_metadata)')
      .eq('workspace_id', auth.workspaceId)
      // critical first, then high, then low, ties broken by recency.
      .order('level', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (!q.data.all) {
      query = query.is('dismissed_at', null).is('acted_on_at', null);
    }
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });

    const alerts = (data ?? []).map((row) => {
      const { nodes, ...alert } = row as typeof row & {
        nodes: { external_metadata: unknown } | null;
      };
      const meta = (nodes?.external_metadata ?? {}) as Record<string, unknown>;
      const raw = (meta.date ?? meta.start) as string | undefined;
      const parsed = raw ? new Date(raw) : null;
      return {
        ...alert,
        // ISO o null. El cliente decide cómo pintarla; null = usar created_at.
        source_date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      };
    });
    return reply.code(200).send({ alerts });
  });

  /**
   * Compact unread count for the nav badge. Cheap so the FE can poll it.
   */
  server.get('/alerts/unread-count', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const { count, error } = await auth.db
      .from('smart_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', auth.workspaceId)
      .is('read_at', null)
      .is('dismissed_at', null)
      .is('acted_on_at', null);
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(200).send({ count: count ?? 0 });
  });

  const AlertActionParams = z.object({ id: z.string().uuid() });
  const AlertActionBody = z.object({
    action: z.enum(['read', 'dismiss', 'acted', 'reopen']),
  });

  /**
   * Lifecycle transitions on an alert.
   *   read     → mark as seen (badge clears)
   *   dismiss  → "not relevant" — hides from default list
   *   acted    → "done" — hides from default list, tracks completion
   *   reopen   → undo dismiss/acted, brings back to open list
   */
  server.post('/alerts/:id/action', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = AlertActionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = AlertActionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_action' });

    const now = new Date().toISOString();
    // Typed precisely so Supabase accepts it. Each action writes a
    // specific subset of the 3 lifecycle columns.
    const update: {
      read_at?: string;
      dismissed_at?: string | null;
      acted_on_at?: string | null;
    } = {};
    switch (body.data.action) {
      case 'read':
        update.read_at = now;
        break;
      case 'dismiss':
        update.dismissed_at = now;
        // Auto-mark read so the badge clears.
        update.read_at = now;
        break;
      case 'acted':
        update.acted_on_at = now;
        update.read_at = now;
        break;
      case 'reopen':
        update.dismissed_at = null;
        update.acted_on_at = null;
        break;
    }

    // Defense in depth: even though RLS restricts UPDATE to user_id =
    // auth.uid(), filter explicitly so a misconfigured policy can't
    // accidentally let one workspace member mutate another's alert.
    const { error } = await auth.db
      .from('smart_alerts')
      .update(update)
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .eq('user_id', auth.userId);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ ok: true });
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
