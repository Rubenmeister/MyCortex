import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { embed } from 'ai';

export const models = {
  classifier: openai('gpt-4o-mini'),
  reasoner: anthropic('claude-3-5-sonnet-latest'),
  fallback: google('gemini-1.5-pro-latest'),
} as const;

export type ModelKey = keyof typeof models;

/** OpenAI text-embedding-3-small. 1536 dims — matches the pgvector column. */
export const EMBEDDING_DIMS = 1536;
export const embeddingModel = openai.embedding('text-embedding-3-small');

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export { generateText, streamText, generateObject, streamObject, embed } from 'ai';
