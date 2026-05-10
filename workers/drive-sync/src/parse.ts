import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

/**
 * Extract plain text from a buffer based on mime type. Returns empty
 * string for unsupported types (caller decides whether to skip).
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/csv'
  ) {
    return buffer.toString('utf8');
  }
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (mimeType === 'application/pdf') {
    const result = await pdfParse(buffer);
    return result.text;
  }
  return '';
}

/**
 * Word-level chunking with overlap. Splits text into chunks of ~`words`
 * words, with `overlap` words shared with the previous chunk to keep
 * context across boundaries.
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
