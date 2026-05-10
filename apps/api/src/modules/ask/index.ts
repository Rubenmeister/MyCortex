import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  embedText,
  generateText,
  models,
  tavilySearch,
  tts,
  type TavilyResult,
} from '@mycortex/ai-core';
import { requireAuth } from '../../lib/auth.js';
import { getEnv } from '../../lib/env.js';
import { transcribeAudio } from '../ingesta/whisper.js';

const TEXT_BODY = z.object({
  text: z.string().trim().min(1),
  audioBase64: z.undefined().optional(),
  mimeType: z.undefined().optional(),
  language: z.undefined().optional(),
  withTTS: z.boolean().optional(),
  /** Force web search even if notes have good matches. Default: smart fallback. */
  forceWeb: z.boolean().optional(),
});
const AUDIO_BODY = z.object({
  text: z.undefined().optional(),
  audioBase64: z.string().min(100),
  mimeType: z.string().regex(/^audio\//),
  language: z.string().length(2).optional(),
  withTTS: z.boolean().optional(),
  forceWeb: z.boolean().optional(),
});
const AskBodySchema = z.union([TEXT_BODY, AUDIO_BODY]);

// Below this similarity, we consider the notes a weak match and reach for the
// web. Calibrated against text-embedding-3-small (related notes ~0.45–0.60).
const WEB_FALLBACK_SIMILARITY = 0.45;

const SYSTEM_PROMPT = `Eres CORTEX, el asistente personal del usuario, con acceso a su segundo cerebro y a búsqueda web.

Tienes dos tipos de fuentes:
- NOTAS: información del propio segundo cerebro del usuario (sus apuntes capturados).
- WEB: resultados de búsqueda en internet, traídos en tiempo real.

Cuando respondas:
- Prioriza la información de las NOTAS si responde la pregunta. Habla naturalmente, como recordando.
- Si las notas no alcanzan, usa la información WEB. Indica brevemente que es info externa ("Según fuentes web…", "En internet aparece…", etc.).
- Si combinas ambas fuentes, sé claro sobre qué viene de dónde.
- Sé directo y conciso (1-3 oraciones, máximo 100 palabras).
- Si no hay info útil de ninguna fuente, dilo honestamente.

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

    // 2. Embed the question + semantic search over the user's workspace.
    const queryEmbedding = await embedText(question);
    const { data: matches, error: searchErr } = await auth.db.rpc('match_nodes', {
      query_embedding: queryEmbedding,
      query_workspace_id: auth.workspaceId,
      match_count: 5,
      match_threshold: 0.25,
    });
    if (searchErr) {
      req.log.error({ err: searchErr.message }, 'match_nodes_failed');
      return reply.code(500).send({ error: 'search_failed', detail: searchErr.message });
    }
    const noteSources = matches ?? [];
    const bestNoteSimilarity = noteSources.length > 0 ? noteSources[0]!.similarity : 0;

    // 3. Decide whether to call Tavily as a fallback / supplement.
    //    - Notes weak (best similarity below threshold)? Yes.
    //    - Caller explicitly requested forceWeb? Yes.
    //    - Tavily key not configured? No (graceful degrade).
    const shouldCallWeb =
      Boolean(env.TAVILY_API_KEY) &&
      (parsed.data.forceWeb === true || bestNoteSimilarity < WEB_FALLBACK_SIMILARITY);

    let webResults: TavilyResult[] = [];
    let webSearchedReason: string | null = null;
    let webMs: number | undefined;
    if (shouldCallWeb && env.TAVILY_API_KEY) {
      const start = Date.now();
      try {
        const tav = await tavilySearch(question, env.TAVILY_API_KEY, {
          searchDepth: 'basic',
          includeAnswer: false,
          maxResults: 4,
        });
        webResults = tav.results;
        webMs = Date.now() - start;
        webSearchedReason = parsed.data.forceWeb
          ? 'force'
          : `weak_notes(best=${bestNoteSimilarity.toFixed(2)})`;
      } catch (err) {
        req.log.warn({ err: String(err) }, 'tavily_failed_continuing_without_web');
        // Web search is supplementary — don't fail the whole request.
      }
    }

    // 4. Build the prompt with both kinds of sources clearly labeled.
    const noteSection =
      noteSources.length === 0
        ? ''
        : `\n\nNOTAS RELEVANTES:\n` +
          noteSources
            .map(
              (s, i) =>
                `  [N${i + 1}] (similitud=${s.similarity.toFixed(2)}, categoria=${s.category}) ${s.content}`,
            )
            .join('\n');
    const webSection =
      webResults.length === 0
        ? ''
        : `\n\nFUENTES WEB:\n` +
          webResults
            .map((r, i) => `  [W${i + 1}] ${r.title} — ${r.url}\n      ${r.content.slice(0, 280)}`)
            .join('\n');

    const userPrompt =
      noteSources.length === 0 && webResults.length === 0
        ? `PREGUNTA: ${question}\n\nNo hay información disponible de ninguna fuente.`
        : `PREGUNTA: ${question}${noteSection}${webSection}`;

    // 5. Generate answer with Claude
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

    // 6. Optional TTS
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
      }
    }

    return reply.code(200).send({
      question,
      answer,
      sources: noteSources.map((s) => ({
        id: s.id,
        content: s.content,
        category: s.category,
        similarity: s.similarity,
        kind: 'note' as const,
      })),
      webSources: webResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 280),
        score: r.score,
        kind: 'web' as const,
      })),
      webSearched: webResults.length > 0,
      webSearchedReason,
      audioBase64,
      ...(transcriptionMs !== undefined && { transcriptionMs }),
      ...(ttsMs !== undefined && { ttsMs }),
      ...(webMs !== undefined && { webMs }),
    });
  });
};
