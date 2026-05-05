import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../lib/auth.js';
import { IngestRequestSchema } from './schema.js';
import { classify } from './classifier.js';
import { insertNode } from './repository.js';
import { enrichNode } from '../accion/enricher.js';

export const ingestaModule: FastifyPluginAsync = async (server) => {
  server.post('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const { source, text, title: explicitTitle } = parsed.data;

    const classification = await classify(text);

    const node = await insertNode(auth.db, {
      user_id: auth.userId,
      kind: classification.kind,
      category: classification.category,
      title: explicitTitle ?? classification.title,
      content: text ?? '',
      source,
    });

    // Fire-and-forget enrichment. JWT lifetime (~1h) >> enrichment time (~200ms).
    // Note: requires the api process to stay alive after responding. Works
    // with Cloud Run min-instances >= 1; for scale-to-zero, switch to a queue.
    setImmediate(() => {
      enrichNode(node.id, auth.jwt)
        .then((outcome) => {
          if (outcome.errors.length > 0) {
            req.log.warn({ outcome }, 'enrichment finished with errors');
          } else {
            req.log.info({ outcome }, 'enrichment ok');
          }
        })
        .catch((err) => req.log.error({ err }, 'enrichment crashed'));
    });

    return reply.code(201).send({ node, classification });
  });
};
