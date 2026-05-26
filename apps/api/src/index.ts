// Load .env BEFORE any other import that touches process.env. `override:true`
// is required because some parent processes (Claude Code CLI, CI runners)
// export empty ANTHROPIC_API_KEY=""/OPENAI_API_KEY="" which dotenv would
// otherwise refuse to overwrite, silently leaving the api keyless.
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

// Sentry tiene que inicializarse ANTES de cualquier require de la app —
// parchea módulos http/fastify en require-time. Si llega tarde, la
// instrumentation queda incompleta (no captura request context). Por eso
// importamos buildServer DESPUÉS de initSentry, con dynamic import.
import { getEnv } from './lib/env.js';
import { initSentry } from './lib/sentry.js';

const env = getEnv();
initSentry({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
});

const { buildServer } = await import('./server.js');
const server = await buildServer();

try {
  await server.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
