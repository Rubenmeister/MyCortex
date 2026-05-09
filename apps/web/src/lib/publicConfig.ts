/**
 * Public client config.
 *
 * These values are PUBLIC by design — they all end up in the client-side
 * JavaScript bundle that any visitor can read. Hardcoding the production
 * defaults sidesteps Vercel's flaky env-var-to-bundle propagation
 * (where NEXT_PUBLIC_* vars sometimes aren't inlined when marked
 * "Sensitive" or under specific monorepo build setups).
 *
 * Security model:
 *   - SUPABASE_URL is the public REST endpoint for the project — anyone
 *     can hit it. RLS on the database enforces who can read/write what.
 *   - SUPABASE_ANON_KEY is also public by design (same reason — it's the
 *     "client" key, not the service role key). Authorization happens at
 *     the JWT level, scoped per logged-in user.
 *   - API_URL is just a public URL. CORS + JWT auth on the api side
 *     gate access.
 *
 * For different environments (staging vs prod, or per-tenant later), set
 * the corresponding NEXT_PUBLIC_* env var in Vercel — it overrides the
 * default below at build time.
 */

const FALLBACKS = {
  apiUrl: 'https://mycortex-api-v5e3u7loza-ue.a.run.app',
  supabaseUrl: 'https://ifsdhwihdjrogebsutem.supabase.co',
  supabaseAnonKey: 'sb_publishable_LbMt0RlbJfDcgTZSF49Wsg_WKvFSd6K',
} as const;

export const publicConfig = {
  apiUrl: nonEmpty(process.env.NEXT_PUBLIC_API_URL) ?? FALLBACKS.apiUrl,
  supabaseUrl: nonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? FALLBACKS.supabaseUrl,
  supabaseAnonKey:
    nonEmpty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? FALLBACKS.supabaseAnonKey,
} as const;

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.trim().length > 0 ? v : undefined;
}
