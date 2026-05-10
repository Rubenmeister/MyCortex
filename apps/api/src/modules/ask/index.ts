import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  cohereRerank,
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

/**
 * Shape returned by match_nodes_hybrid. We re-declare here to avoid leaking
 * Supabase's `unknown` types into every callsite.
 */
type HybridMatch = {
  id: string;
  title: string | null;
  content: string;
  category: string;
  source: string;
  external_source: string | null;
  external_id: string | null;
  external_metadata: Record<string, unknown> | null;
  created_at: string;
  similarity: number;
  keyword_score: number;
  rrf_score: number;
};

/**
 * Build a short human-readable attribution label per source. Used in the
 * prompt so Claude can write "según tu doc X" / "en el mail Y de Z" and
 * surfaced in the FE source list.
 */
function attributionLabel(s: HybridMatch): string {
  const meta = (s.external_metadata ?? {}) as Record<string, unknown>;
  if (s.external_source === 'drive') {
    const filename = (meta.filename as string | undefined) ?? s.title ?? 'Drive file';
    return `Drive › ${filename}`;
  }
  if (s.external_source === 'gmail') {
    const subj = (meta.subject as string | undefined) ?? s.title ?? '(sin asunto)';
    const from = (meta.from as string | undefined) ?? '';
    // Trim from to display name only if possible: "Name <email>" -> "Name"
    const fromShort = from.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim() ?? from;
    return fromShort
      ? `Gmail › "${subj.slice(0, 60)}" — ${fromShort.slice(0, 40)}`
      : `Gmail › "${subj.slice(0, 60)}"`;
  }
  // Plain note / capture
  if (s.title) return `Nota: ${s.title.slice(0, 60)}`;
  return `Nota (${s.source})`;
}

// Below this similarity, we consider the user's notes weak enough to reach
// for live web search. Calibrated against text-embedding-3-small: a single
// note that incidentally shares a keyword with the question (e.g. a "hola
// desde Quito" capture matching a "clima en Quito" query) easily scores
// 0.55-0.65 even when it answers nothing. We need a threshold that
// distinguishes "this note IS the answer" from "this note shares a word".
// 0.70 is empirical: clearly on-topic notes about a topic the user took
// real notes on (e.g. their Madrid trip planning) score 0.70+; incidental
// keyword overlaps stay below.
const WEB_FALLBACK_SIMILARITY = 0.7;

const SYSTEM_PROMPT_NOTES_ONLY = `Eres CORTEX, el asistente personal del usuario, con acceso a su segundo cerebro (notas, Drive, Gmail).

Cada fuente lleva una ETIQUETA tipo [N1], [N2]… con su origen (Nota / Drive / Gmail).

Reglas:
- Prioriza siempre las fuentes para responder. Habla naturalmente.
- Cuando uses una fuente, refiérete a ella por su origen específico cuando sea relevante:
    * "Según el doc 'X' de tu Drive…"
    * "En el mail de Y sobre 'Z'…"
    * "Tu nota del [fecha] dice…"
- Sé directo y conciso (1-3 oraciones, máximo 120 palabras).
- Si las fuentes no contienen la respuesta, dilo honestamente: "No encontré nada sobre eso en tu segundo cerebro".
- NO inventes información. NO cites "fuentes web" o "internet" — en esta consulta solo tienes el segundo cerebro.

Match the language of the question.`;

const SYSTEM_PROMPT_WITH_WEB = `Eres CORTEX, el asistente personal del usuario, con acceso a su segundo cerebro (notas, Drive, Gmail) Y a búsqueda web en tiempo real.

Tipos de fuentes:
- [N1], [N2]…  Fuentes del segundo cerebro (etiqueta indica origen: Nota / Drive / Gmail).
- [W1], [W2]…  Resultados de búsqueda web hechos AHORA para esta pregunta.

Reglas:
- Prioriza el segundo cerebro si responde la pregunta. Si no alcanza, complementa con FUENTES WEB.
- Cuando uses una fuente del segundo cerebro, refiérete a ella por su origen específico:
    * "Según el doc 'X' de tu Drive…"
    * "En el mail de Y sobre 'Z'…"
- Cuando uses una FUENTE WEB, indícalo: "Según fuentes web…", "En internet aparece…", etc.
- Si combinas ambas, sé claro sobre qué viene de dónde.
- Sé directo y conciso (1-3 oraciones, máximo 120 palabras).
- Si ninguna fuente alcanza, dilo honestamente.

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

    // 2. Embed the question + hybrid search (vector + keyword via RRF).
    //    We pull 20 candidates so the reranker has a meaningful pool to
    //    re-score; without rerank we just take the top of these 20.
    const queryEmbedding = await embedText(question);
    const { data: matches, error: searchErr } = await auth.db.rpc('match_nodes_hybrid', {
      query_embedding: queryEmbedding,
      query_text: question,
      query_workspace_id: auth.workspaceId,
      match_count: 20,
      match_threshold: 0.25,
    });
    if (searchErr) {
      req.log.error({ err: searchErr.message }, 'match_nodes_hybrid_failed');
      return reply.code(500).send({ error: 'search_failed', detail: searchErr.message });
    }
    const rawCandidates = (matches ?? []) as HybridMatch[];

    // 2b. Reranker: re-score the 20 candidates with a cross-encoder and
    //     keep the top 5. Cross-encoders read (query, doc) together so they
    //     catch nuances vector + keyword miss. We do this only if a Cohere
    //     key is set; otherwise we fall back to the top 5 from hybrid.
    const TOP_K_FINAL = 5;
    let noteSources: HybridMatch[];
    let rerankMs: number | undefined;
    const rerankScoreById = new Map<string, number>();
    if (env.COHERE_API_KEY && rawCandidates.length > 1) {
      const rerankStart = Date.now();
      try {
        // We rerank against title+content so the cross-encoder sees the
        // structured attribution context, not just the chunked body.
        const reranked = await cohereRerank(
          question,
          rawCandidates.map((c) => ({
            ...c,
            text: c.title ? `${c.title}\n\n${c.content}` : c.content,
          })),
          env.COHERE_API_KEY,
          { topN: TOP_K_FINAL },
        );
        noteSources = reranked.map((r) => {
          rerankScoreById.set(r.doc.id, r.score);
          return r.doc as HybridMatch;
        });
        rerankMs = Date.now() - rerankStart;
      } catch (err) {
        req.log.warn({ err: String(err) }, 'cohere_rerank_failed_falling_back_to_hybrid');
        noteSources = rawCandidates.slice(0, TOP_K_FINAL);
      }
    } else {
      noteSources = rawCandidates.slice(0, TOP_K_FINAL);
    }
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

    // 4. Build the prompt with both kinds of sources clearly labeled. Each
    //    note source includes its origin (Nota / Drive / Gmail with subject)
    //    so the LLM can write specific attributions in the answer.
    const noteSection =
      noteSources.length === 0
        ? ''
        : `\n\nFUENTES DE TU SEGUNDO CEREBRO:\n` +
          noteSources
            .map(
              (s, i) =>
                `  [N${i + 1}] ${attributionLabel(s)} (similitud=${s.similarity.toFixed(2)}, score=${s.rrf_score.toFixed(3)})\n      ${s.content.slice(0, 1200)}`,
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

    // 5. Generate answer with Claude.
    //    Pick the prompt that matches what we actually gave it: telling
    //    Claude it has web access when we didn't search the web makes it
    //    invent "según fuentes web" attributions.
    const systemPrompt =
      webResults.length > 0 ? SYSTEM_PROMPT_WITH_WEB : SYSTEM_PROMPT_NOTES_ONLY;
    let answer: string;
    try {
      const result = await generateText({
        model: models.reasoner,
        system: systemPrompt,
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
        kind: 'note' as const,
        // What origin the source came from:
        // 'drive' / 'gmail' = external integration; 'note' = direct capture.
        origin:
          s.external_source === 'drive'
            ? ('drive' as const)
            : s.external_source === 'gmail'
              ? ('gmail' as const)
              : ('note' as const),
        title: s.title,
        attribution: attributionLabel(s),
        content: s.content,
        category: s.category,
        source: s.source,
        externalMetadata: s.external_metadata,
        createdAt: s.created_at,
        similarity: s.similarity,
        keywordScore: s.keyword_score,
        rrfScore: s.rrf_score,
        rerankScore: rerankScoreById.get(s.id) ?? null,
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
      ...(rerankMs !== undefined && { rerankMs }),
      rerankApplied: rerankScoreById.size > 0,
      candidatesEvaluated: rawCandidates.length,
    });
  });
};
