import { getEnv } from '../../lib/env.js';

export type WhisperResult = {
  text: string;
  durationMs: number;
};

/**
 * Transcribe an audio buffer with OpenAI Whisper. We hit the REST API
 * directly because the audio multipart form is trivial and we sidestep
 * one layer of SDK abstraction.
 *
 * Caller is responsible for checking that OPENAI_API_KEY is set —
 * we throw a descriptive error if it's missing rather than silently
 * falling back, since voice without transcription is a degenerate UX.
 */
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  opts: { language?: string } = {},
): Promise<WhisperResult> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required for voice transcription');
  }

  const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'm4a';
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mimeType }),
    `voice.${ext}`,
  );
  form.append('model', 'whisper-1');
  if (opts.language) form.append('language', opts.language);

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  const durationMs = Date.now() - start;

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`whisper ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { text: string };
  return { text: json.text.trim(), durationMs };
}
