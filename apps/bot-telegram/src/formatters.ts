import type { IngestResponse, CortexRunResponse, RecentNode } from './api.js';

const KIND_EMOJI: Record<string, string> = {
  task: '📋',
  idea: '💡',
  reference: '🔗',
  fragment: '✂️',
  note: '📝',
};

const CATEGORY_EMOJI: Record<string, string> = {
  going: '🚐',
  personal: '👤',
  urgent: '⚡',
  unknown: '❓',
};

export function formatIngest(res: IngestResponse, transcript?: string): string {
  const { classification, node } = res;
  const ke = KIND_EMOJI[classification.kind] ?? '📝';
  const ce = CATEGORY_EMOJI[classification.category] ?? '❓';
  const title = classification.title ?? node.id.slice(0, 8);
  const lines = [
    transcript ? `🎙️ _${escapeMd(transcript)}_\n` : '',
    `${ke} *${escapeMd(title)}*`,
    `${ce} _${classification.category}_  ·  ${ke} _${classification.kind}_`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatRecent(nodes: RecentNode[]): string {
  if (nodes.length === 0) return 'No tienes notas todavía. Envíame algo.';
  return nodes
    .map((n, i) => {
      const ke = KIND_EMOJI[n.kind] ?? '📝';
      const ce = CATEGORY_EMOJI[n.category] ?? '❓';
      const title = n.title ?? n.content.slice(0, 50);
      const preview = n.content.slice(0, 80).replace(/\n+/g, ' ');
      return `${i + 1}. ${ke}${ce} *${escapeMd(title)}*\n   _${escapeMd(preview)}_`;
    })
    .join('\n\n');
}

export function formatCortexRun(r: CortexRunResponse): string {
  const total = r.byAction.merge + r.byAction.complement + r.byAction.correct;
  if (total === 0) {
    return `🧠 Run \`${r.runId.slice(0, 8)}\`\n\n` +
           `Examiné *${r.nodesExamined}* nodos, encontré *${r.clustersFound}* clusters.\n` +
           `_Sin sugerencias accionables esta vez._`;
  }
  return (
    `🧠 Run \`${r.runId.slice(0, 8)}\`\n\n` +
    `Examiné *${r.nodesExamined}* nodos, encontré *${r.clustersFound}* clusters.\n\n` +
    `*${total}* sugerencias:\n` +
    `🔀 merge: ${r.byAction.merge}\n` +
    `➕ complement: ${r.byAction.complement}\n` +
    `✏️ correct: ${r.byAction.correct}\n` +
    `_(usa el dashboard para revisarlas)_`
  );
}

// Telegram MarkdownV1 needs minimal escaping (we use parse_mode='Markdown')
function escapeMd(s: string): string {
  return s.replace(/[*_`[\]]/g, (m) => `\\${m}`);
}
