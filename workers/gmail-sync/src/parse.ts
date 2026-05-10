import { parse as parseHtml } from 'node-html-parser';

/**
 * Strip HTML to plain text. We use node-html-parser (cheap, no DOM)
 * and then collapse whitespace + drop common boilerplate signature
 * markers.
 */
export function htmlToText(html: string): string {
  const root = parseHtml(html, { lowerCaseTagName: false, comment: false });
  // Remove style/script blocks that bloat the text but contain no signal.
  root.querySelectorAll('style, script, noscript').forEach((el) => el.remove());
  let text = root.text;
  // Collapse runs of whitespace + dedupe blank lines.
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Drop quoted reply chains and signatures from message text. This is
 * heuristic — Gmail/Outlook etc. all use slightly different conventions.
 * We catch the most common ones:
 *   - Lines starting with ">" (RFC 822 quoting)
 *   - "On <date>, <sender> wrote:" preludes
 *   - Signatures starting with "--" or "Sent from my"
 */
export function stripQuotesAndSignature(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inQuote = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // Reply-prelude detection (common across clients/locales).
    if (
      /^On .+ wrote:$/i.test(trimmed) ||
      /^El .+ escribió:$/i.test(trimmed) ||
      /^Le .+ a écrit\s*:$/i.test(trimmed) ||
      /^Am .+ schrieb .+:$/i.test(trimmed) ||
      /^-+ ?Original Message ?-+/i.test(trimmed) ||
      /^From: .+/i.test(trimmed)
    ) {
      inQuote = true;
      continue;
    }
    if (inQuote) continue;
    // RFC 822 ">" quote prefix.
    if (line.startsWith('>')) continue;
    // Signature delimiter.
    if (trimmed === '--' || trimmed === '-- ') break;
    // Mobile-client trailers.
    if (/^Sent from my /i.test(trimmed)) break;
    if (/^Enviado desde mi /i.test(trimmed)) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Word-level chunking with overlap. Mirrors drive-sync.
 */
export function chunkText(
  text: string,
  opts: { words?: number; overlap?: number } = {},
): string[] {
  const targetWords = opts.words ?? 500;
  const overlap = opts.overlap ?? 100;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const words = cleaned.split(' ');
  if (words.length <= targetWords) return [cleaned];

  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + targetWords);
    chunks.push(slice.join(' '));
    if (i + targetWords >= words.length) break;
    i += targetWords - overlap;
  }
  return chunks;
}
