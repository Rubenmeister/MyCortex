import Fastify from 'fastify';
import { Telegraf } from 'telegraf';

const PORT = Number(process.env.PORT ?? 4100);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const server = Fastify({ logger: true });

bot.on('text', async (ctx) => {
  await fetch(`${API_URL}/ingesta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'telegram',
      userId: String(ctx.from?.id ?? ''),
      text: ctx.message.text,
    }),
  });
  await ctx.reply('Captured.');
});

server.post('/webhook', async (req, reply) => {
  await bot.handleUpdate(req.body as Parameters<typeof bot.handleUpdate>[0]);
  return reply.code(200).send();
});

server.get('/health', async () => ({ status: 'ok' }));

await server.listen({ port: PORT, host: '0.0.0.0' });
