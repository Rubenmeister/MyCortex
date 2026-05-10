import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/^@mycortex\//, /^@supabase\//, /^@ai-sdk\//, 'ai'],
  external: ['node-html-parser', 'zod'],
});
