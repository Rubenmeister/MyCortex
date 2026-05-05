import { buildServer } from './server.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = await buildServer();

try {
  await server.listen({ port: PORT, host: HOST });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
