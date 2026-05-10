import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../lib/auth.js';
import { IngestRequestSchema, IngestAudioRequestSchema } from './schema.js';
import { classify } from './classifier.js';
import { insertNode } from './repository.js';
import { enrichNode } from '../accion/enricher.js';
import { transcribeAudio } from './whisper.js';

export const ingestaModule: FastifyPluginAsync = async (server) => {
  async function ingestText(
    auth: NonNullable<Awaited<ReturnType<typeof requireAuth>>>,
    args: {
      source: 'telegram' | 'mobile' | 'web' | 'api' | 'drive' | 'gmail';
      text: string;
      explicitTitle?: string;
    },
    reqLog: { log: { warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void; error: (...a: unknown[]) => void } },
  ) {
    const classification = await classify(args.text);
    const node = await insertNode(auth.db, {
      workspace_id: auth.workspaceId,
      user_id: auth.userId,
      kind: classification.kind,
      category: classification.category,
      title: args.explicitTitle ?? classification.title,
      content: args.text,
      source: args.source,
    });
    setImmediate(() => {
      enrichNode(node.id, auth.jwt)
        .then((outcome) => {
          if (outcome.errors.length > 0) reqLog.log.warn({ outcome }, 'enrichment finished with errors');
          else reqLog.log.info({ outcome }, 'enrichment ok');
        })
        .catch((err) => reqLog.log.error({ err }, 'enrichment crashed'));
    });
    return { node, classification };
  }

  server.post('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const { source, text, title: explicitTitle } = parsed.data;
    if (!text) {
      return reply.code(400).send({ error: 'text_required_for_this_endpoint' });
    }

    const result = await ingestText(auth, { source, text, explicitTitle }, req);
    return reply.code(201).send(result);
  });

  /**
   * Voice ingest. Mobile app records audio, sends base64. Server transcribes
   * via Whisper, then runs the same classify + insert + enrich pipeline.
   * Returns the transcript so the client can show "esto fue lo que escuché".
   *
   * Body limit is bumped to 10 MB at server level — 5 min of OGG/M4A fits.
   */
  server.post('/audio', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const parsed = IngestAudioRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const { source, audioBase64, mimeType, language, title: explicitTitle } = parsed.data;

    let transcript: string;
    let transcriptionMs: number;
    try {
      const buf = Buffer.from(audioBase64, 'base64');
      const result = await transcribeAudio(buf, mimeType, { language });
      transcript = result.text;
      transcriptionMs = result.durationMs;
    } catch (err) {
      req.log.error({ err: String(err) }, 'whisper_failed');
      return reply.code(502).send({ error: 'transcription_failed', detail: String(err).slice(0, 200) });
    }

    if (!transcript) {
      return reply.code(422).send({ error: 'empty_transcript' });
    }

    const result = await ingestText(auth, { source, text: transcript, explicitTitle }, req);
    return reply.code(201).send({ ...result, transcript, transcriptionMs });
  });
};
