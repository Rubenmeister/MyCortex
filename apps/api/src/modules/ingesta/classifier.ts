import { generateObject, models } from '@mycortex/ai-core';
import { getEnv } from '../../lib/env.js';
import { ClassificationSchema, type Classification } from './schema.js';

const SYSTEM_PROMPT = `You triage incoming notes for a personal knowledge system.
Return:
- kind: the type of note ('note' for plain capture, 'task' for action items, 'idea' for novel concepts, 'reference' for links/sources, 'fragment' for partial/unclear)
- category: domain ('going' = work/Going startup; 'personal'; 'urgent' if time-sensitive; 'unknown' otherwise)
- title: a 4-7 word headline, or null if the input is too short.`;

const FALLBACK: Classification = { kind: 'note', category: 'unknown', title: null };

export async function classify(text: string | undefined): Promise<Classification> {
  if (!text) return FALLBACK;
  const env = getEnv();
  if (!env.OPENAI_API_KEY) return FALLBACK;

  try {
    const { object } = await generateObject({
      model: models.classifier,
      schema: ClassificationSchema,
      system: SYSTEM_PROMPT,
      prompt: text,
    });
    return object;
  } catch {
    return FALLBACK;
  }
}
