import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

export const models = {
  classifier: openai('gpt-4o-mini'),
  reasoner: anthropic('claude-3-5-sonnet-latest'),
  fallback: google('gemini-1.5-pro-latest'),
} as const;

export type ModelKey = keyof typeof models;

export { generateText, streamText, generateObject, streamObject } from 'ai';
