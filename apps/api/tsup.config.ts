import { defineConfig } from 'tsup';

/**
 * Bundle config for the api. Workspace deps (@mycortex/*) point their `main`
 * to .ts source for dev ergonomics — but Node 20 in prod can't import .ts
 * directly. tsup bundles those into the output so the runtime only needs
 * external npm deps (fastify, supabase-js, etc.) installed in node_modules.
 *
 * Result: a single dist/index.js (~few hundred KB) plus require()s to
 * external libs at runtime.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle workspace packages (Node can't load .ts at runtime) AND
  // libs that are transitive deps via workspace packages — pnpm doesn't
  // place transitives in apps/api/node_modules so the runtime can't
  // resolve them from there. Direct deps (fastify et al) stay external
  // and get installed in node_modules at the runtime stage.
  noExternal: [/^@mycortex\//, /^@supabase\//, /^@ai-sdk\//, 'ai'],
  external: [
    'fastify',
    '@fastify/cors',
    '@fastify/sensible',
    'fastify-plugin',
    'dotenv',
    'zod',
    'pino-pretty',
  ],
});
