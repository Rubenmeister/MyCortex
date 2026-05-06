// Load .env BEFORE any other import that touches process.env. `override:true`
// is required because some parent processes (Claude Code CLI, CI runners)
// export empty ANTHROPIC_API_KEY=""/OPENAI_API_KEY="" which dotenv would
// otherwise refuse to overwrite, silently leaving the api keyless.
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import { buildServer } from './server.js';
import { getEnv } from './lib/env.js';

const env = getEnv();
const server = await buildServer();

try {
  await server.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
