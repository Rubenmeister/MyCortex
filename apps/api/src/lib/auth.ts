import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createUserDb, type Db } from '@mycortex/db';
import { getDb } from './db.js';
import { getEnv } from './env.js';

export type Authed = {
  userId: string;
  jwt: string;
  db: Db;
};

/**
 * Validate the request and return user identity + scoped DB client.
 *
 * Two auth paths:
 *   1. **User JWT** (default): `Authorization: Bearer <user-jwt>`. Validated
 *      via supabase.auth.getUser. Returns a user-scoped DB client (RLS).
 *   2. **Admin trust** (server-to-server): the request presents the service
 *      role key AND an X-MyCortex-User-Id header. Used by the Telegram bot
 *      and other trusted internal services. Returns a service-role DB
 *      client — RLS bypassed, so the caller must be 100% trusted.
 *
 * On failure: writes 401 to the reply and returns null. Caller early-returns.
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

  // Admin trust path: service-role key + explicit user_id header.
  if (token === env.SUPABASE_SERVICE_ROLE_KEY) {
    const userIdHeader = req.headers['x-mycortex-user-id'];
    const parsed = z
      .string()
      .uuid()
      .safeParse(typeof userIdHeader === 'string' ? userIdHeader : '');
    if (!parsed.success) {
      reply.code(401).send({ error: 'admin_missing_user_header' });
      return null;
    }
    return { userId: parsed.data, jwt: token, db: getDb() };
  }

  // Standard user JWT path.
  const { data, error } = await getDb().auth.getUser(token);
  if (error || !data.user) {
    reply.code(401).send({ error: 'invalid_token' });
    return null;
  }
  const db = createUserDb(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, token);
  return { userId: data.user.id, jwt: token, db };
}
