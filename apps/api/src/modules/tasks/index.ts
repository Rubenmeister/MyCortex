import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { TaskInsert, TaskUpdate } from '@mycortex/db/types';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { incrementAiOps } from '../../lib/plans.js';
import { extractActionItems } from './extract.js';

const ListQuery = z.object({
  status: z.enum(['todo', 'doing', 'done']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const CreateBody = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(2000).optional(),
  priority: z.enum(['alta', 'media', 'baja']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  origin: z.enum(['manual', 'coach', 'extracted', 'meeting']).optional(),
  sourceNodeId: z.string().uuid().nullable().optional(),
  sourceSuggestionId: z.string().uuid().nullable().optional(),
});

const UpdateBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  detail: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['todo', 'doing', 'done']).optional(),
  priority: z.enum(['alta', 'media', 'baja']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

const IdParams = z.object({ id: z.string().uuid() });

export const tasksModule: FastifyPluginAsync = async (server) => {
  /** Tablero del workspace. Filtrable por status. */
  server.get('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });

    let query = auth.db
      .from('tasks')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })
      .limit(q.data.limit);
    if (q.data.status) query = query.eq('status', q.data.status);
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ tasks: data ?? [] });
  });

  /** Crear tarea (a mano, desde el coach, una reunión, etc.). */
  server.post('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });

    const insert: TaskInsert = {
      workspace_id: auth.workspaceId,
      user_id: auth.userId,
      title: body.data.title,
      detail: body.data.detail ?? null,
      priority: body.data.priority ?? 'media',
      due_date: body.data.dueDate ?? null,
      origin: body.data.origin ?? 'manual',
      source_node_id: body.data.sourceNodeId ?? null,
      source_suggestion_id: body.data.sourceSuggestionId ?? null,
    };
    const { data, error } = await auth.db.from('tasks').insert(insert).select().single();
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(201).send({ task: data });
  });

  /** Editar tarea / mover en el tablero. status=done sella completed_at. */
  server.patch('/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = UpdateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });

    const update: TaskUpdate = {};
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.detail !== undefined) update.detail = body.data.detail;
    if (body.data.priority !== undefined) update.priority = body.data.priority;
    if (body.data.dueDate !== undefined) update.due_date = body.data.dueDate;
    if (body.data.status !== undefined) {
      update.status = body.data.status;
      update.completed_at = body.data.status === 'done' ? new Date().toISOString() : null;
    }
    if (Object.keys(update).length === 0) return reply.code(400).send({ error: 'empty_update' });

    const { data: updated, error } = await auth.db
      .from('tasks')
      .update(update)
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .select('source_suggestion_id')
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error' });

    // Cierre del loop: completar una tarea nacida de una sugerencia marca la
    // sugerencia como hecha, para que el seguimiento del coach lo reconozca.
    if (body.data.status === 'done' && updated?.source_suggestion_id) {
      const now = new Date().toISOString();
      await auth.db
        .from('coach_suggestions')
        .update({ status: 'done', done_at: now, read_at: now })
        .eq('id', updated.source_suggestion_id)
        .eq('workspace_id', auth.workspaceId);
    }
    return reply.code(200).send({ ok: true });
  });

  server.delete('/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { error } = await auth.db
      .from('tasks')
      .delete()
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ ok: true });
  });

  /**
   * Extrae action items del material reciente y los crea como tareas
   * (origin='extracted'). Caro (LLM sobre hasta 60 nodos): rate-limit 4/min.
   */
  server.post(
    '/extract',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = await requireAuth(req, reply);
      if (!auth) return;
      const env = getEnv();
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: 'anthropic_required' });

      const q = z
        .object({ lookbackDays: z.coerce.number().int().min(1).max(60).optional() })
        .safeParse(req.body ?? {});
      const lookbackDays = q.success ? q.data.lookbackDays : undefined;

      let items;
      try {
        items = await extractActionItems(auth.db, auth.workspaceId, { lookbackDays });
        void incrementAiOps(auth.workspaceId);
      } catch (err) {
        req.log.error({ err: String(err) }, 'tasks_extract_failed');
        return reply.code(502).send({ error: 'extract_failed' });
      }
      if (items.length === 0) return reply.code(200).send({ created: 0, tasks: [] });

      const rows: TaskInsert[] = items.map((it) => ({
        workspace_id: auth.workspaceId,
        user_id: auth.userId,
        title: it.title,
        detail: it.detail,
        priority: it.priority,
        origin: 'extracted',
        source_node_id: it.sourceNodeId,
      }));
      const { data, error } = await auth.db.from('tasks').insert(rows).select();
      if (error) return reply.code(500).send({ error: 'db_error' });
      return reply.code(201).send({ created: data?.length ?? 0, tasks: data ?? [] });
    },
  );
};
