// Load .env BEFORE anything that reads process.env. override:true because
// the parent process can have empty AI keys exported (Claude Code CLI does).
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import Fastify from 'fastify';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { createDb } from '@mycortex/db';
import { loadConfig } from './config.js';
import { ApiClient, type BotIdentity } from './api.js';
import { transcribe } from './whisper.js';
import { formatCortexRun, formatIngest, formatRecent } from './formatters.js';

const cfg = loadConfig();
const api = new ApiClient(cfg);
const bot = new Telegraf(cfg.TELEGRAM_BOT_TOKEN);

// Service-role DB client for telegram_links lookups + token validation.
const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Resolve which MyCortex user (and which workspace) a Telegram chat
 * belongs to. Multi-user mode is preferred; falls back to the legacy
 * TELEGRAM_DEFAULT_USER_ID env so users who haven't migrated still
 * get their messages ingested.
 *
 * Returns null if there's no link AND no fallback — the caller should
 * tell the chat to vinculate first.
 */
async function identityFor(chatId: number): Promise<BotIdentity | null> {
  const { data } = await db
    .from('telegram_links')
    .select('user_id, workspace_id')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (data) {
    return { userId: data.user_id, workspaceId: data.workspace_id };
  }
  if (cfg.TELEGRAM_DEFAULT_USER_ID) {
    return { userId: cfg.TELEGRAM_DEFAULT_USER_ID };
  }
  return null;
}

const UNLINKED_HINT =
  'No estás vinculado a una cuenta de MyCortex.\n\n' +
  '1. Abre MyCortex web → *Ajustes → Vincular Telegram*\n' +
  '2. Click el botón "Vincular" y abre el link aquí\n' +
  '3. Vuelvo a estar a tus órdenes';

/**
 * Handle /start TOKEN (deep-link from the web). Validates the token,
 * upserts a telegram_links row, marks the token consumed. The chat is
 * now linked for all future messages.
 */
async function handleLinkPayload(
  chatId: number,
  payload: string,
  telegramUser: { username?: string; firstName?: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: tok, error: lookupErr } = await db
    .from('telegram_link_tokens')
    .select('*')
    .eq('token', payload)
    .maybeSingle();
  if (lookupErr) return { ok: false, reason: 'lookup_failed' };
  if (!tok) return { ok: false, reason: 'token_not_found' };
  if (tok.used_at) return { ok: false, reason: 'token_already_used' };
  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'token_expired' };
  }

  const { error: upsertErr } = await db
    .from('telegram_links')
    .upsert(
      {
        chat_id: chatId,
        user_id: tok.user_id,
        workspace_id: tok.workspace_id,
        telegram_username: telegramUser.username ?? null,
        telegram_first_name: telegramUser.firstName ?? null,
        linked_by_token: payload,
      },
      { onConflict: 'chat_id' },
    );
  if (upsertErr) return { ok: false, reason: 'link_save_failed' };

  await db
    .from('telegram_link_tokens')
    .update({ used_at: new Date().toISOString(), used_by_chat_id: chatId })
    .eq('token', payload);

  return { ok: true };
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name ?? 'there';
  // Telegram /start can carry a payload after a deep-link:
  // https://t.me/MyBot?start=TOKEN. Telegraf surfaces it as startPayload.
  const payload = (ctx as { startPayload?: string }).startPayload;

  if (payload) {
    const result = await handleLinkPayload(ctx.chat.id, payload, {
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
    });
    if (result.ok) {
      await ctx.reply(
        `✅ Vinculado, ${name}.\n\n` +
          `Lo que me mandes a partir de ahora se guarda en *tu* segundo cerebro.\n\n` +
          `*Comandos:*\n` +
          `/last — tus últimas 5 notas\n` +
          `/cortex — disparar evolución\n` +
          `/help — ayuda`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    const reasonMsg =
      result.reason === 'token_expired'
        ? '⏰ Ese link de vinculación expiró. Genera uno nuevo desde MyCortex web.'
        : result.reason === 'token_already_used'
          ? '🔁 Ese link ya se usó. Genera uno nuevo desde MyCortex web.'
          : '❌ Link de vinculación inválido. Genera uno nuevo desde MyCortex web.';
    await ctx.reply(reasonMsg);
    return;
  }

  // No payload — generic welcome. Check if they're already linked.
  const id = await identityFor(ctx.chat.id);
  if (id) {
    await ctx.reply(
      `👋 Hola ${name}, ya estás vinculado.\n\n` +
        `Mandame texto o audio para capturar. /last para ver tus últimas notas.`,
    );
    return;
  }

  await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
});

bot.help((ctx) =>
  ctx.reply(
    'Mandame texto o audio. Comandos:\n' +
      '/coach — tu coaching de crecimiento\n' +
      '/last — últimas notas\n' +
      '/cortex — run evolución\n' +
      '/whoami — qué cuenta tengo linkeada',
  ),
);

bot.command('whoami', async (ctx) => {
  const id = await identityFor(ctx.chat.id);
  if (!id) {
    await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
    return;
  }
  await ctx.reply(
    `Linkeado a:\n• user_id: \`${id.userId}\`\n• workspace: \`${id.workspaceId ?? 'personal (default)'}\``,
    { parse_mode: 'Markdown' },
  );
});

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // commands handled by their own routes

  const id = await identityFor(ctx.chat.id);
  if (!id) {
    await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
    return;
  }

  try {
    const res = await api.ingest(id, { source: 'telegram', text });
    await ctx.reply(formatIngest(res), { parse_mode: 'Markdown' });
  } catch (err) {
    // In webhook mode Cloud Run may freeze the request between Fastify
    // ACK and the actual Telegram API call. Awaiting ensures the error
    // message reaches the user before the function returns.
    await ctx.telegram
      .sendMessage(ctx.chat.id, `❌ ${String(err).slice(0, 200)}`)
      .catch(() => {});
  }
});

bot.on(message('voice'), async (ctx) => {
  const id = await identityFor(ctx.chat.id);
  if (!id) {
    await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
    return;
  }
  if (!cfg.OPENAI_API_KEY) {
    await ctx.reply('🔇 No tengo OPENAI_API_KEY configurado, no puedo transcribir.');
    return;
  }

  const wait = await ctx.reply('🎙️ Transcribiendo...');

  try {
    const link = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const audioRes = await fetch(link.href);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const text = await transcribe(audioBuffer, cfg.OPENAI_API_KEY, {
      mimeType: ctx.message.voice.mime_type ?? 'audio/ogg',
      language: 'es',
    });

    const res = await api.ingest(id, { source: 'telegram', text });

    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(formatIngest(res, text), { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${String(err).slice(0, 200)}`);
  }
});

bot.command('last', async (ctx) => {
  const id = await identityFor(ctx.chat.id);
  if (!id) {
    await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
    return;
  }
  try {
    const { nodes } = await api.recentNodes(id, 5);
    await ctx.reply(formatRecent(nodes), { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ ${String(err).slice(0, 200)}`);
  }
});

bot.command('cortex', async (ctx) => {
  const id = await identityFor(ctx.chat.id);
  if (!id) {
    await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
    return;
  }
  const wait = await ctx.reply('🧠 Ejecutando evolución...');
  try {
    const summary = await api.runCortex(id);
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(formatCortexRun(summary), { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${String(err).slice(0, 200)}`);
  }
});

bot.command('coach', async (ctx) => {
  const id = await identityFor(ctx.chat.id);
  if (!id) {
    await ctx.reply(UNLINKED_HINT, { parse_mode: 'Markdown' });
    return;
  }
  const wait = await ctx.reply('🎯 Pensando tu coaching...');
  try {
    const { result } = await api.coach(id);
    const prio: Record<string, string> = { alta: '🔴', media: '🟡', baja: '🔵' };
    const top = result.suggestions
      .slice()
      .sort((a, b) => (a.priority === 'alta' ? -1 : 1) - (b.priority === 'alta' ? -1 : 1))
      .slice(0, 3)
      .map((s) => `${prio[s.priority] ?? '•'} *${s.title}*\n${s.action}`)
      .join('\n\n');
    const msg =
      `🎯 *Tu foco*\n${result.focus}\n\n` + (top ? `*Sugerencias:*\n${top}` : result.summary);
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${String(err).slice(0, 200)}`);
  }
});

bot.on(message('photo'), async (ctx) => {
  await ctx.reply('📷 Las fotos van por la app móvil (próximo). Por ahora: texto o voz.');
});

bot.catch((err, ctx) => {
  console.error(JSON.stringify({ level: 'error', msg: 'bot_uncaught', err: String(err) }));
  ctx.reply('Error procesando. Revisa los logs.').catch(() => {});
});

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Launch the bot in one of two modes:
 *
 * 1. WEBHOOK MODE (production, Cloud Run): Telegram POSTs each update to
 *    `${BOT_PUBLIC_URL}/webhook`. We start a tiny Fastify server that
 *    listens on Cloud Run's PORT, validates the secret header, and feeds
 *    the update into Telegraf. Cloud Run can scale to zero between
 *    bursts; warm-up latency is masked by Telegram retries.
 *
 * 2. LONG-POLLING MODE (local dev): no webhook URL → bot.launch() opens
 *    a persistent connection to Telegram and polls for updates. Simpler
 *    for dev but needs a process running 24/7 (not Cloud-Run-friendly).
 */
if (cfg.BOT_PUBLIC_URL && cfg.BOT_WEBHOOK_SECRET) {
  const fastify = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

  // Cloud Run healthcheck — must respond <10s on cold start.
  fastify.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Telegram POSTs here with each incoming update.
  fastify.post('/webhook', async (req, reply) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== cfg.BOT_WEBHOOK_SECRET) {
      log('webhook_invalid_secret');
      return reply.code(401).send({ error: 'invalid_secret' });
    }
    try {
      // Telegraf's handleUpdate takes the raw update object.
      await bot.handleUpdate(req.body as Parameters<typeof bot.handleUpdate>[0]);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      log('webhook_handler_error', { err: String(err).slice(0, 200) });
      // 200 anyway — Telegram retries on non-2xx, and a bad update is
      // better dropped than re-delivered forever.
      return reply.code(200).send({ ok: true });
    }
  });

  await fastify.listen({ port: cfg.PORT, host: '0.0.0.0' });
  log('bot_http_listening', { port: cfg.PORT });

  // Register the webhook with Telegram. Idempotent — if the URL/secret
  // hasn't changed, Telegram just ACKs. Done after server is listening
  // so we can't miss the first update.
  const webhookUrl = `${cfg.BOT_PUBLIC_URL.replace(/\/$/, '')}/webhook`;
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: cfg.BOT_WEBHOOK_SECRET,
    drop_pending_updates: false,
  });
  log('webhook_registered', { url: webhookUrl });
} else {
  // Long-polling fallback (local dev).
  await bot.launch();
  log('bot_started_longpolling', {
    multiUser: true,
    defaultUserFallback: cfg.TELEGRAM_DEFAULT_USER_ID
      ? `${cfg.TELEGRAM_DEFAULT_USER_ID.slice(0, 8)}…`
      : 'none',
  });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
