// Load .env BEFORE anything that reads process.env. override:true because
// the parent process can have empty AI keys exported (Claude Code CLI does).
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { loadConfig } from './config.js';
import { ApiClient } from './api.js';
import { transcribe } from './whisper.js';
import { formatCortexRun, formatIngest, formatRecent } from './formatters.js';

const cfg = loadConfig();
const api = new ApiClient(cfg);
const bot = new Telegraf(cfg.TELEGRAM_BOT_TOKEN);

/**
 * MVP single-user mapping. Every chat ingests as TELEGRAM_DEFAULT_USER_ID.
 * When we add multi-tenant: replace with a SELECT against telegram_links
 * (chat_id, user_id) and a /link command for onboarding.
 */
function userIdFor(_chatId: number): string {
  return cfg.TELEGRAM_DEFAULT_USER_ID;
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name ?? 'there';
  await ctx.reply(
    `👋 Hola ${name}, soy CORTEX.\n\n` +
      `Envíame *texto* o *audio* y lo capturo en tu segundo cerebro. ` +
      `Yo lo clasifico, le pongo título, genero embedding y lo conecto con notas similares.\n\n` +
      `*Comandos:*\n` +
      `/last — tus últimas 5 notas\n` +
      `/cortex — disparar capa de evolución\n` +
      `/help — esta ayuda`,
    { parse_mode: 'Markdown' },
  );
});

bot.help((ctx) =>
  ctx.reply(
    'Mándame texto o audio. Comandos: /last (últimas notas), /cortex (run evolución).',
  ),
);

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // commands handled by their own routes
  const userId = userIdFor(ctx.chat.id);

  try {
    const res = await api.ingest(userId, { source: 'telegram', text });
    await ctx.reply(formatIngest(res), { parse_mode: 'Markdown' });
  } catch (err) {
    ctx.telegram.sendMessage(ctx.chat.id, `❌ ${String(err).slice(0, 200)}`).catch(() => {});
  }
});

bot.on(message('voice'), async (ctx) => {
  const userId = userIdFor(ctx.chat.id);
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

    const res = await api.ingest(userId, { source: 'telegram', text });

    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(formatIngest(res, text), { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${String(err).slice(0, 200)}`);
  }
});

bot.command('last', async (ctx) => {
  const userId = userIdFor(ctx.chat.id);
  try {
    const { nodes } = await api.recentNodes(userId, 5);
    await ctx.reply(formatRecent(nodes), { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`❌ ${String(err).slice(0, 200)}`);
  }
});

bot.command('cortex', async (ctx) => {
  const userId = userIdFor(ctx.chat.id);
  const wait = await ctx.reply('🧠 Ejecutando evolución...');
  try {
    const summary = await api.runCortex(userId);
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(formatCortexRun(summary), { parse_mode: 'Markdown' });
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

await bot.launch(() => {
  console.log(JSON.stringify({ level: 'info', msg: 'bot_started', defaultUserId: cfg.TELEGRAM_DEFAULT_USER_ID }));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
