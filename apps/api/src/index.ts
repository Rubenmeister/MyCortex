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
