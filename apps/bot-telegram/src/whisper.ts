/**
 * Whisper-1 transcription via OpenAI REST. We hit the API directly instead
 * of going through @ai-sdk/openai because the audio multipart form is
 * trivially small and we sidestep one layer of abstraction.
 */
export async function transcribe(
  audio: Buffer,
  apiKey: string,
  opts: { mimeType?: string; language?: string } = {},
): Promise<string> {
  const form = new FormData();
  // new Uint8Array(audio) gives a fresh, properly-typed view that Blob accepts
  // even under strict TS (avoids SharedArrayBuffer ambiguity in Buffer types).
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: opts.mimeType ?? 'audio/ogg' }),
    'voice.ogg',
  );
  form.append('model', 'whisper-1');
  if (opts.language) form.append('language', opts.language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`whisper ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { text: string };
  return json.text.trim();
}
