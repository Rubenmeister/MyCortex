import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Send a sanitized error response. Logs the real error server-side
 * (where it's useful for debugging) but returns a short stable code +
 * generic message to the client (where raw DB errors could leak schema,
 * constraint names, RLS policy names, or PII via Postgres detail
 * messages).
 *
 * Usage:
 *   const { data, error } = await db.from('x').select();
 *   if (error) return sendError(req, reply, 500, 'db_error', error);
 */
export function sendError(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  realError: unknown,
): FastifyReply {
  // Log server-side with the full error so we can debug from Cloud
  // Logging without exposing it to the client.
  req.log.error({ code, err: String(realError) }, code);
  return reply.code(statusCode).send({ error: code });
}

/**
 * Same idea but for cases where we want to keep a short generic detail
 * (e.g. a Zod validation issue summary) without echoing the raw DB
 * message. The `detail` here must be a string we authored, not a
 * passthrough from a 3rd party.
 */
export function sendErrorWithDetail(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  detail: string,
  realError?: unknown,
): FastifyReply {
  if (realError) {
    req.log.error({ code, err: String(realError) }, code);
  }
  return reply.code(statusCode).send({ error: code, detail });
}
