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
  } catch (err) {
    // Surface the failure instead of swallowing it. The route still gets a
    // safe fallback so ingesta never blocks, but we log enough to diagnose
    // quota / model / network issues.
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'classifier_fallback',
        reason: String(err).slice(0, 300),
      }),
    );
    return FALLBACK;
  }
}
