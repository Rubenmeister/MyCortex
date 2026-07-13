import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { embed, generateText } from 'ai';

export const models = {
  classifier: openai('gpt-4o-mini'),
  reasoner: anthropic('claude-sonnet-4-6'),
  fallback: google('gemini-2.5-pro'),
} as const;

export type ModelKey = keyof typeof models;

/** OpenAI text-embedding-3-small. 1536 dims — matches the pgvector column. */
export const EMBEDDING_DIMS = 1536;
export const embeddingModel = openai.embedding('text-embedding-3-small');

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

/**
 * OpenAI TTS via REST. Returns raw MP3 bytes — base64 encoding is the
 * caller's choice (we do it on the api side before sending to web/mobile).
 *
 * `nova` is the warmest voice and works well for Spanish.
 */
export async function tts(
  text: string,
  apiKey: string,
  opts: { voice?: TTSVoice; format?: 'mp3' | 'opus' | 'aac' | 'wav' } = {},
): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'tts-1',
      voice: opts.voice ?? 'nova',
      input: text,
      response_format: opts.format ?? 'mp3',
    }),
  });
  if (!res.ok) {
    throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const IMAGE_OCR_PROMPT =
  'Transcribe TODO el texto visible en esta imagen (OCR). Si además hay contenido no textual relevante, ' +
  'descríbelo en una línea. Si no hay texto, describe brevemente qué muestra. Responde solo con el ' +
  'texto/descripción, sin preámbulos. Español neutro de Ecuador ("tú", nunca voseo).';

/**
 * OCR + descripción de una imagen usando el modelo con visión (Claude). Para
 * capturar imágenes (WhatsApp, etc.) al segundo cerebro como texto buscable.
 */
export async function describeImage(
  image: Buffer | Uint8Array,
  opts: { mimeType?: string; prompt?: string } = {},
): Promise<string> {
  const { text } = await generateText({
    model: models.reasoner,
    maxTokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: opts.prompt ?? IMAGE_OCR_PROMPT },
          { type: 'image', image, ...(opts.mimeType ? { mimeType: opts.mimeType } : {}) },
        ],
      },
    ],
  });
  return text.trim();
}

export { tavilySearch, type TavilyResult, type TavilySearchResponse, type TavilySearchOptions } from './tavily.js';
export { cohereRerank, type RerankedHit } from './rerank.js';

export { generateText, streamText, generateObject, streamObject, embed } from 'ai';
