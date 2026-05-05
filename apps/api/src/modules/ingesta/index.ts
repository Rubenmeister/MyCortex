import type { FastifyPluginAsync } from 'fastify';
import { IngestRequestSchema } from './schema.js';
import { classify } from './classifier.js';
import { insertNode } from './repository.js';

export const ingestaModule: FastifyPluginAsync = async (server) => {
  server.post('/', async (req, reply) => {
    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const { userId, source, text, title: explicitTitle } = parsed.data;

    const classification = await classify(text);

    const node = await insertNode({
      user_id: userId,
      kind: classification.kind,
      category: classification.category,
      title: explicitTitle ?? classification.title,
      content: text ?? '',
      source,
    });

    return reply.code(201).send({ node, classification });
  });
};
