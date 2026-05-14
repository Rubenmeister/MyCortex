import { z } from 'zod';
import { getEnv } from '../../lib/env.js';

/**
 * Minimal WhatsApp Cloud API (Meta Graph) client. We use only:
 *   - sendText: reply to incoming messages with text
 *   - downloadMedia: fetch the actual bytes of a voice/image/document
 *     given a media_id from a webhook payload.
 *
 * No npm SDK — Meta's API is a few simple JSON endpoints. Direct fetch
 * keeps deps small.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export async function sendText(phoneNumber: string, text: string): Promise<void> {
  const env = getEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('whatsapp_not_configured');
  }
  const res = await fetch(`${GRAPH_BASE}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'text',
      text: { body: text },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `whatsapp_send_failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
}

const MediaInfoSchema = z.object({
  url: z.string().url(),
  mime_type: z.string(),
  sha256: z.string().optional(),
  file_size: z.number().optional(),
});

/**
 * Two-step media download: Graph API gives us a one-time signed URL,
 * then we fetch the actual bytes from that URL (still need the
 * access token for the second request).
 */
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const env = getEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('whatsapp_not_configured');
  }
  const infoRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!infoRes.ok) {
    throw new Error(`whatsapp_media_info_failed: ${infoRes.status}`);
  }
  const info = MediaInfoSchema.parse(await infoRes.json());
  const blobRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!blobRes.ok) {
    throw new Error(`whatsapp_media_download_failed: ${blobRes.status}`);
  }
  return { buffer: Buffer.from(await blobRes.arrayBuffer()), mimeType: info.mime_type };
}
