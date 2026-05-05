import { generateObject, models } from '@mycortex/ai-core';
import type { NodeRow } from '@mycortex/db/types';
import { FusionResultSchema, FUSION_SYSTEM_PROMPT, type FusionResult } from './prompts.js';
import type { Neighbor } from './cluster.js';

const SKIP: FusionResult = {
  action: 'skip',
  reasoning: 'no_neighbors_above_threshold',
  suggestedContent: null,
  affectedNodeIds: [],
};

export async function fuseCluster(
  target: NodeRow,
  neighbors: Neighbor[],
  hasAnthropicKey: boolean,
): Promise<FusionResult> {
  if (neighbors.length === 0) return SKIP;
  if (!hasAnthropicKey) {
    return {
      ...SKIP,
      reasoning: 'fusion_skipped:no_anthropic_key',
      affectedNodeIds: neighbors.map((n) => n.id),
    };
  }

  const userPrompt = buildPrompt(target, neighbors);

  try {
    const { object } = await generateObject({
      model: models.reasoner,
      schema: FusionResultSchema,
      system: FUSION_SYSTEM_PROMPT,
      prompt: userPrompt,
    });
    return object;
  } catch (err) {
    return {
      ...SKIP,
      reasoning: `fusion_error:${String(err).slice(0, 200)}`,
      affectedNodeIds: neighbors.map((n) => n.id),
    };
  }
}

function buildPrompt(target: NodeRow, neighbors: Neighbor[]): string {
  const ctx = neighbors
    .map((n, i) => `[CTX ${i + 1}] id=${n.id} similarity=${n.similarity.toFixed(3)}\n${n.content}`)
    .join('\n\n');
  return `TARGET id=${target.id} kind=${target.kind} category=${target.category}
${target.content}

CONTEXTS (semantic neighbors):
${ctx}`;
}
