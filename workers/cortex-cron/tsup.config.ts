import { defineConfig } from 'tsup';

/**
 * Same pattern as the api: bundle workspace deps so Node can run dist/index.js
 * without resolving any @mycortex/* package at runtime. External libs stay
 * external and get installed normally in the runtime stage.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/^@mycortex\//, /^@supabase\//, /^@ai-sdk\//, 'ai'],
  external: ['zod'],
});
