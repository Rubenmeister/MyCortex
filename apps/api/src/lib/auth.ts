import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createUserDb, type Db } from '@mycortex/db';
import { getDb } from './db.js';
import { getEnv } from './env.js';

export type Authed = {
  userId: string;
  workspaceId: string;
  jwt: string;
  db: Db;
};

/**
 * Validate the request and return user identity + workspace context + scoped DB.
 *
 * Two auth paths:
 *   1. **User JWT** (default): `Authorization: Bearer <user-jwt>`. Validated
 *      via supabase.auth.getUser. Returns a user-scoped DB client (RLS).
 *   2. **Admin trust** (server-to-server): the request presents the service
 *      role key AND an `X-MyCortex-User-Id` header. Used by the Telegram bot
 *      and other trusted internal services. Returns a service-role DB
 *      client — RLS bypassed, so the caller must be 100% trusted.
 *
 * Workspace resolution (both paths):
 *   - Optional `X-MyCortex-Workspace-Id` header overrides the default
 *   - Otherwise we look up the user's personal workspace (auto-created on
 *     signup by the `handle_new_user` trigger)
 *   - Both paths verify that the resolved workspace_id is one the user
 *     actually belongs to (via workspace_members). RLS would catch this on
 *     queries anyway, but failing fast at the auth layer surfaces the error
 *     in one place with a clear status code.
 *
 * On failure: writes 401/403 to the reply and returns null.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Authed | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'missing_authorization' });
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  const env = getEnv();

  // Resolve userId from either auth path.
  let userId: string;
  let db: Db;

  if (token === env.SUPABASE_SERVICE_ROLE_KEY) {
    // Admin trust path
    const userIdHeader = req.headers['x-mycortex-user-id'];
    const parsed = z
      .string()
      .uuid()
      .safeParse(typeof userIdHeader === 'string' ? userIdHeader : '');
    if (!parsed.success) {
      reply.code(401).send({ error: 'admin_missing_user_header' });
      return null;
    }
    userId = parsed.data;
    db = getDb();
  } else {
    // Standard user JWT path
    const { data, error } = await getDb().auth.getUser(token);
    if (error || !data.user) {
      reply.code(401).send({ error: 'invalid_token' });
      return null;
    }
    userId = data.user.id;
    db = createUserDb(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, token);
  }

  // Resolve workspace.
  const workspaceIdHeader = req.headers['x-mycortex-workspace-id'];
  const explicitWorkspaceId =
    typeof workspaceIdHeader === 'string'
      ? z.string().uuid().safeParse(workspaceIdHeader)
      : null;

  let workspaceId: string;
  if (explicitWorkspaceId?.success) {
    // Confirm the user is actually a member of this workspace.
    const { data, error } = await getDb()
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', explicitWorkspaceId.data)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) {
      reply.code(403).send({ error: 'not_a_member_of_workspace' });
      return null;
    }
    workspaceId = data.workspace_id;
  } else {
    // Default to the personal workspace.
    const { data, error } = await getDb()
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_personal', true)
      .maybeSingle();
    if (error || !data) {
      reply.code(500).send({ error: 'personal_workspace_missing' });
      return null;
    }
    workspaceId = data.id;
  }

  return { userId, workspaceId, jwt: token, db };
}
