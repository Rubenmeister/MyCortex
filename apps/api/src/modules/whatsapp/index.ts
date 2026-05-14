import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import { getEnv } from '../../lib/env.js';
import { transcribeAudio } from '../ingesta/whisper.js';
import { downloadMedia, sendText } from './client.js';

/**
 * WhatsApp Cloud API integration. Multi-user via whatsapp_links.
 *
 * Routes:
 *   GET  /webhooks/whatsapp        — Meta verification handshake
 *   POST /webhooks/whatsapp        — incoming message webhook
 *   POST /integrations/whatsapp/start-link  — issue one-time 6-char token
 *   GET  /integrations/whatsapp/links       — list user's linked numbers
 *   DELETE /integrations/whatsapp/links/:phone — unlink
 *
 * Linking flow (no deep link possible — WhatsApp has nothing like t.me):
 *   1. User clicks "Vincular WhatsApp" in web.
 *   2. API issues a 6-char alphanumeric token.
 *   3. UI tells user: "Mandá `LINK ABC123` por WhatsApp al +593...".
 *   4. User opens WhatsApp on their phone, sends that exact message.
 *   5. Webhook receives the message, parses LINK <token>, validates,
 *      upserts whatsapp_links, replies "✅ Vinculado".
 *   6. Future messages from that phone route to the linked user.
 */

const LINK_PREFIX = /^link\s+([A-Z0-9]{6})\s*$/i;

function generateLinkToken(): string {
  // 6 chars from an unambiguous alphabet (no 0/O, 1/I/L). Easier to type
  // by hand on a phone keyboard.
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

/**
 * Validate Meta's webhook signature. Meta signs the raw request body
 * with HMAC-SHA256 using the app secret; result goes in
 * X-Hub-Signature-256 as `sha256=<hex>`.
 */
function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const env = getEnv();
  if (!env.WHATSAPP_APP_SECRET || !signatureHeader) return false;
  const expected = 'sha256=' +
    createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signatureHeader);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

// Webhook payload schemas — Meta's API has a lot of optional fields,
// we only parse what we need.
const MessageSchema = z.object({
  from: z.string(), // sender phone (E.164 without +)
  id: z.string(),
  timestamp: z.string(),
  type: z.string(), // 'text' | 'audio' | 'voice' | 'image' | 'video' | etc.
  text: z.object({ body: z.string() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  voice: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  image: z.object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() }).optional(),
});

const ContactSchema = z.object({
  wa_id: z.string(),
  profile: z.object({ name: z.string().optional() }).optional(),
});

const WebhookEntrySchema = z.object({
  changes: z.array(
    z.object({
      value: z.object({
        messaging_product: z.literal('whatsapp').optional(),
        contacts: z.array(ContactSchema).optional(),
        messages: z.array(MessageSchema).optional(),
        statuses: z.array(z.unknown()).optional(),
      }),
    }),
  ),
});

const WebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account').optional(),
  entry: z.array(WebhookEntrySchema),
});

async function handleLinkAttempt(args: {
  phoneNumber: string;
  token: string;
  displayName?: string;
}): Promise<{ ok: true; user_id: string; workspace_id: string } | { ok: false; reason: string }> {
  const db = getDb();
  const { data: tok } = await db
    .from('whatsapp_link_tokens')
    .select('*')
    .eq('token', args.token.toUpperCase())
    .maybeSingle();
  if (!tok) return { ok: false, reason: 'token_not_found' };
  if (tok.used_at) return { ok: false, reason: 'token_already_used' };
  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'token_expired' };
  }

  const { error: upsertErr } = await db
    .from('whatsapp_links')
    .upsert(
      {
        phone_number: args.phoneNumber,
        user_id: tok.user_id,
        workspace_id: tok.workspace_id,
        display_name: args.displayName ?? null,
        linked_by_token: tok.token,
      },
      { onConflict: 'phone_number' },
    );
  if (upsertErr) return { ok: false, reason: 'link_save_failed' };

  await db
    .from('whatsapp_link_tokens')
    .update({ used_at: new Date().toISOString(), used_by_phone_number: args.phoneNumber })
    .eq('token', tok.token);

  return { ok: true, user_id: tok.user_id, workspace_id: tok.workspace_id };
}

async function identityForPhone(
  phoneNumber: string,
): Promise<{ userId: string; workspaceId: string } | null> {
  const db = getDb();
  const { data } = await db
    .from('whatsapp_links')
    .select('user_id, workspace_id')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  if (!data) return null;
  return { userId: data.user_id, workspaceId: data.workspace_id };
}

export const whatsappModule: FastifyPluginAsync = async (server) => {
  // ---- Webhook: GET (verification handshake) ----------------------------
  // Meta sends ?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y.
  // We respond with Y if X matches. Required ONCE at webhook registration.
  server.get('/webhooks/whatsapp', async (req, reply) => {
    const env = getEnv();
    const q = z
      .object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      })
      .safeParse(req.query);
    if (!q.success || q.data['hub.mode'] !== 'subscribe') {
      return reply.code(400).send({ error: 'invalid_handshake' });
    }
    if (!env.WHATSAPP_VERIFY_TOKEN || q.data['hub.verify_token'] !== env.WHATSAPP_VERIFY_TOKEN) {
      return reply.code(403).send({ error: 'invalid_verify_token' });
    }
    return reply.code(200).send(q.data['hub.challenge'] ?? '');
  });

  // ---- Webhook: POST (incoming messages) --------------------------------
  server.post('/webhooks/whatsapp', async (req, reply) => {
    const sigHeader = req.headers['x-hub-signature-256'];
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!verifySignature(raw, typeof sigHeader === 'string' ? sigHeader : undefined)) {
      req.log.warn('whatsapp_invalid_signature');
      // Always ACK so Meta doesn't keep retrying; we just drop.
      return reply.code(200).send({ ok: true });
    }

    const parsed = WebhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(200).send({ ok: true }); // unknown payload shape
    }

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];
        for (const msg of messages) {
          const displayName = contacts.find((c) => c.wa_id === msg.from)?.profile?.name;
          await processMessage(msg, displayName).catch((err) =>
            req.log.error({ err: String(err) }, 'whatsapp_message_failed'),
          );
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });

  // ---- POST /integrations/whatsapp/start-link ---------------------------
  server.post('/integrations/whatsapp/start-link', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const env = getEnv();

    // Issue a fresh 6-char token. Retry a few times if random gives us
    // a value that already exists (effectively never with 30^6 = 7.3B
    // values, but defensively).
    let token = '';
    for (let tries = 0; tries < 5; tries++) {
      token = generateLinkToken();
      const { data: existing } = await getDb()
        .from('whatsapp_link_tokens')
        .select('token')
        .eq('token', token)
        .maybeSingle();
      if (!existing) break;
    }

    const { error } = await getDb()
      .from('whatsapp_link_tokens')
      .insert({
        token,
        user_id: auth.userId,
        workspace_id: auth.workspaceId,
      });
    if (error) {
      return reply.code(500).send({ error: 'db_error' });
    }

    return reply.code(200).send({
      token,
      display_number: env.WHATSAPP_DISPLAY_NUMBER ?? null,
      // Pre-baked message the user just has to send to the WhatsApp number.
      message_to_send: `LINK ${token}`,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  });

  // ---- GET /integrations/whatsapp/links ---------------------------------
  server.get('/integrations/whatsapp/links', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const { data, error } = await getDb()
      .from('whatsapp_links')
      .select('phone_number, workspace_id, display_name, linked_at')
      .eq('user_id', auth.userId)
      .order('linked_at', { ascending: false });
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(200).send({ links: data ?? [] });
  });

  // ---- DELETE /integrations/whatsapp/links/:phone -----------------------
  server.delete('/integrations/whatsapp/links/:phone', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ phone: z.string().min(8).max(20) }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_phone' });

    const { error } = await getDb()
      .from('whatsapp_links')
      .delete()
      .eq('phone_number', params.data.phone)
      .eq('user_id', auth.userId);
    if (error) return reply.code(500).send({ error: 'db_error' });
    return reply.code(204).send();
  });
};

/**
 * Process a single incoming WhatsApp message.
 *
 * Flow:
 *   - text starting with LINK XXXXXX → linking handshake (calls
 *     handleLinkAttempt, replies success/failure)
 *   - other message types only proceed if the phone is already linked;
 *     otherwise reply with linking instructions.
 *   - text / voice / image → ingest as a node tagged source='whatsapp'
 *     (note: nodes.source enum may need a 'whatsapp' add — done in
 *     a follow-up migration; for now we tag with closest existing).
 */
async function processMessage(
  msg: z.infer<typeof MessageSchema>,
  displayName?: string,
): Promise<void> {
  // 1. Linking handshake (works without prior link)
  if (msg.type === 'text' && msg.text) {
    const match = LINK_PREFIX.exec(msg.text.body.trim());
    if (match) {
      const token = match[1]!;
      const result = await handleLinkAttempt({
        phoneNumber: msg.from,
        token,
        displayName,
      });
      if (result.ok) {
        await sendText(
          msg.from,
          `✅ Vinculado a MyCortex.\nA partir de ahora, lo que me mandes (texto, voz, fotos) se guarda en tu segundo cerebro.`,
        );
      } else {
        const txt =
          result.reason === 'token_expired'
            ? '⏰ Ese código de vinculación expiró. Generá uno nuevo desde MyCortex web.'
            : result.reason === 'token_already_used'
              ? '🔁 Ese código ya se usó. Generá uno nuevo desde MyCortex web.'
              : '❌ Código inválido. Generá uno nuevo desde MyCortex web (Ajustes → Vincular WhatsApp).';
        await sendText(msg.from, txt);
      }
      return;
    }
  }

  // 2. All other paths require an existing link
  const identity = await identityForPhone(msg.from);
  if (!identity) {
    await sendText(
      msg.from,
      'No estás vinculado a MyCortex.\n\n' +
        '1. Abrí MyCortex web → Ajustes → Vincular WhatsApp\n' +
        '2. Te genera un código tipo `LINK ABC123`\n' +
        '3. Pegalo acá tal cual y te queda vinculado.',
    );
    return;
  }

  // 3. Ingest by type. We POST to the api's existing /ingesta endpoint
  //    using the service-role admin path with user_id + workspace_id
  //    headers (same trick as the Telegram bot).
  const env = getEnv();
  const apiUrl = `${getApiOrigin()}/ingesta`;

  if (msg.type === 'text' && msg.text) {
    await ingestText(apiUrl, env, identity, msg.text.body);
    await sendText(msg.from, '📝 Capturado en tu cerebro.');
    return;
  }

  if ((msg.type === 'voice' || msg.type === 'audio') && (msg.voice || msg.audio)) {
    const mediaId = (msg.voice ?? msg.audio)!.id;
    const { buffer, mimeType } = await downloadMedia(mediaId);
    // Reuse the existing Whisper helper for transcription.
    const result = await transcribeAudio(buffer, mimeType, { language: 'es' });
    if (!result.text) {
      await sendText(msg.from, '🎙️ No pude transcribir el audio. Probá de nuevo o mandalo como texto.');
      return;
    }
    await ingestText(apiUrl, env, identity, result.text);
    await sendText(
      msg.from,
      `🎙️ Transcrito y capturado:\n"${result.text.slice(0, 200)}${result.text.length > 200 ? '…' : ''}"`,
    );
    return;
  }

  if (msg.type === 'image') {
    // For v1 we capture the caption only; image upload + OCR is a follow-up.
    const caption = msg.image?.caption?.trim();
    if (caption) {
      await ingestText(apiUrl, env, identity, caption);
      await sendText(msg.from, '🖼 Caption capturado. (OCR de imagen aún pendiente.)');
    } else {
      await sendText(
        msg.from,
        '🖼 Recibí la imagen, pero todavía no hago OCR. Mandala con un texto que la describa y la capturo.',
      );
    }
    return;
  }

  await sendText(msg.from, `Tipo de mensaje no soportado todavía (${msg.type}). Por ahora: texto, voz, imagen con caption.`);
}

function getApiOrigin(): string {
  // The whatsapp module is hosted by the api itself, so we just hit our
  // own loopback. process.env.API_URL would be the deployed origin if we
  // ever split the webhook off, but loopback avoids the extra round-trip.
  const env = getEnv();
  return `http://127.0.0.1:${env.PORT}`;
}

async function ingestText(
  apiUrl: string,
  env: ReturnType<typeof getEnv>,
  identity: { userId: string; workspaceId: string },
  text: string,
): Promise<void> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'X-MyCortex-User-Id': identity.userId,
      'X-MyCortex-Workspace-Id': identity.workspaceId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source: 'whatsapp', text }),
  });
  if (!res.ok) {
    throw new Error(`ingest_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
