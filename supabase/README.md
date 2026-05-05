# Supabase

## Apply migrations to your Supabase project

```bash
# install Supabase CLI once: https://supabase.com/docs/guides/cli
supabase link --project-ref <your-project-ref>
supabase db push
```

## Regenerate TypeScript types

```bash
SUPABASE_PROJECT_ID=<your-project-ref> pnpm --filter @mycortex/db gen:types
```

This overwrites `packages/db/src/types.ts` from the live schema.
