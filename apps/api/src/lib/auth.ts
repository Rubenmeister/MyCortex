import type { FastifyReply, FastifyRequest } from 'fastify';
import { createUserDb, type Db } from '@mycortex/db';
import { getDb } from './db.js';
import { getEnv } from './env.js';

export type Authed = {
  userId: string;
  jwt: string;
  db: Db;
};

/**
 * Validate the Bearer token, return user identity + a user-scoped DB client.
 * On failure: writes 401 to the reply and returns null. Caller must early-return.
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
  const jwt = header.slice('Bearer '.length).trim();

  const { data, error } = await getDb().auth.getUser(jwt);
  if (error || !data.user) {
    reply.code(401).send({ error: 'invalid_token' });
    return null;
  }

  const env = getEnv();
  const db = createUserDb(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, jwt);

  return { userId: data.user.id, jwt, db };
}
