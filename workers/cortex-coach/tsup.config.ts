import { defineConfig } from 'tsup';

/**
 * Bundle workspace deps (incluido @mycortex/cortex-engine) así Node corre
 * dist/index.js sin resolver paquetes @mycortex/* en runtime. zod queda
 * external y se instala normal en el stage de runtime.
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
