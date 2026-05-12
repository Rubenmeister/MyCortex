import { defineConfig } from 'tsup';

/**
 * Bundle config for the Telegram bot. Same pattern as the api: workspace
 * packages reference .ts source for dev ergonomics, so we bundle them
 * into the output. Telegraf and fastify remain external (installed via
 * pnpm install --prod in the runtime stage).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/^@mycortex\//, /^@supabase\//],
  external: ['telegraf', 'fastify', 'dotenv', 'zod'],
});
