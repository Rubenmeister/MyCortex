'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazy Supabase client.
 *
 * Why: at build time Next.js prerenders pages and evaluates this module.
 * If env vars haven't propagated yet (or the build runs before
 * `NEXT_PUBLIC_*` are wired), `createClient('', '', ...)` throws
 * "supabaseUrl is required" and the whole build fails — even on routes
 * that never actually need Supabase at runtime.
 *
 * Solution: initialize on first access. Build-time evaluation no longer
 * touches credentials. Real users hitting the page in the browser get a
 * working client with the right env vars. If env vars are still missing
 * at first use, we surface a clear error instead of silently failing.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel project settings.',
    );
  }
  _client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

// Proxy so callers can keep `import { supabase }` and use it like a
// regular client. All property/method access lazily resolves to the
// initialized instance the first time it's touched.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as SupabaseClient;
