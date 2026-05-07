import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { embedText, generateText, models, tts } from '@mycortex/ai-core';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { transcribeAudio } from '../ingesta/whisper.js';

const TEXT_BODY = z.object({
  text: z.string().trim().min(1),
  audioBase64: z.undefined().optional(),
  mimeType: z.undefined().optional(),
  language: z.undefined().optional(),
  withTTS: z.boolean().optional(),
});
const AUDIO_BODY = z.object({
  text: z.undefined().optional(),
  audioBase64: z.string().min(100),
  mimeType: z.string().regex(/^audio\//),
  language: z.string().length(2).optional(),
  withTTS: z.boolean().optional(),
});
const AskBodySchema = z.union([TEXT_BODY, AUDIO_BODY]);

const SYSTEM_PROMPT = `Eres CORTEX, el asistente personal del usuario, con acceso a su segundo cerebro.

Responde a la pregunta usando ÚNICAMENTE las notas relevantes que se te proporcionan. Sé directo y conciso (1-3 oraciones, máximo 80 palabras). No digas "según tus notas" — habla naturalmente como si recordaras la información.

Si las notas no contienen información relevante, dilo honestamente: "No encontré nada sobre eso en tus notas".

Match the language of the question.`;

export const askModule: FastifyPluginAsync = async (server) => {
  server.post('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
      return reply.code(503).send({ error: 'openai_required_for_ask' });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({ error: 'anthropic_required_for_ask' });
    }

    const parsed = AskBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    // 1. Resolve question (text directly OR transcribe audio)
    let question: string;
    let transcriptionMs: number | undefined;
    if ('text' in parsed.data && parsed.data.text) {
      question = parsed.data.text;
    } else {
      const { audioBase64, mimeType, language } = parsed.data as z.infer<typeof AUDIO_BODY>;
      try {
        const buf = Buffer.from(audioBase64, 'base64');
        const result = await transcribeAudio(buf, mimeType, { language });
        question = result.text;
        transcriptionMs = result.durationMs;
      } catch (err) {
        req.log.error({ err: String(err) }, 'whisper_failed_in_ask');
        return reply.code(502).send({ error: 'transcription_failed', detail: String(err).slice(0, 200) });
      }
      if (!question) return reply.code(422).send({ error: 'empty_transcript' });
    }

    // 2. Embed the question + semantic search (lower threshold than cortex
    //    evolution because queries should be inclusive — better to surface
    //    weakly-related notes than to say "no info" too aggressively).
    const queryEmbedding = await embedText(question);
    const { data: matches, error: searchErr } = await auth.db.rpc('match_nodes', {
      query_embedding: queryEmbedding,
      query_user_id: auth.userId,
      match_count: 5,
      match_threshold: 0.25,
    });
    if (searchErr) {
      req.log.error({ err: searchErr.message }, 'match_nodes_failed');
      return reply.code(500).send({ error: 'search_failed', detail: searchErr.message });
    }
    const sources = matches ?? [];

    // 3. Generate answer with Claude
    const userPrompt =
      sources.length === 0
        ? `PREGUNTA: ${question}\n\nNo hay notas relevantes en la base de conocimiento.`
        : `PREGUNTA: ${question}\n\nNOTAS RELEVANTES:\n` +
          sources
            .map(
              (s, i) =>
                `[${i + 1}] (similitud=${s.similarity.toFixed(2)}, categoria=${s.category}) ${s.content}`,
            )
            .join('\n');

    let answer: string;
    try {
      const result = await generateText({
        model: models.reasoner,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
      });
      answer = result.text.trim();
    } catch (err) {
      req.log.error({ err: String(err) }, 'claude_failed_in_ask');
      return reply.code(502).send({ error: 'answer_generation_failed', detail: String(err).slice(0, 200) });
    }

    // 4. Optional TTS
    let audioBase64: string | undefined;
    let ttsMs: number | undefined;
    if (parsed.data.withTTS) {
      const start = Date.now();
      try {
        const audio = await tts(answer, env.OPENAI_API_KEY, { voice: 'nova' });
        audioBase64 = audio.toString('base64');
        ttsMs = Date.now() - start;
      } catch (err) {
        req.log.warn({ err: String(err) }, 'tts_failed_continuing_without_audio');
        // Don't fail the whole request — text answer is still useful.
      }
    }

    return reply.code(200).send({
      question,
      answer,
      sources: sources.map((s) => ({
        id: s.id,
        content: s.content,
        category: s.category,
        similarity: s.similarity,
      })),
      audioBase64,
      ...(transcriptionMs !== undefined && { transcriptionMs }),
      ...(ttsMs !== undefined && { ttsMs }),
    });
  });
};
