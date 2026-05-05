import { z } from 'zod';

export const FusionResultSchema = z.object({
  action: z.enum(['merge', 'complement', 'correct', 'skip']),
  reasoning: z.string().min(1).max(500),
  suggestedContent: z.string().nullable(),
  affectedNodeIds: z.array(z.string().uuid()),
});
export type FusionResult = z.infer<typeof FusionResultSchema>;

export const FUSION_SYSTEM_PROMPT = `You are a knowledge curator for a personal note system. You receive:
- TARGET: a newly captured note
- CONTEXTS: notes that are semantically similar to the target (already in the system)

Decide what to do with the target:
- "merge"      target duplicates one of the contexts. Almost identical info.
- "complement" target adds new info to a context. Their union is richer.
- "correct"    target contradicts or updates a context. Newer is more accurate.
- "skip"       target stands alone. No fusion needed.

Output strict JSON. Always cite affectedNodeIds (the contexts involved). Keep
reasoning under 500 chars. suggestedContent only when action is merge/complement/correct
and represents the consolidated note that should replace/extend the context.

Match the language of the input notes.`;

export const SUMMARY_SYSTEM_PROMPT = `You are a personal knowledge curator writing the
"Resumen de Evolución" — a short, friendly markdown summary of what changed in the user's
knowledge base since the last run.

Receive a list of suggested actions. Group by action type. Be concise. Use emojis sparingly.
Match the user's language. Keep under 250 words.`;
