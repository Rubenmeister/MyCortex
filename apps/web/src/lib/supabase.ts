'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig } from './publicConfig';

/**
 * Lazy Supabase client. Reads from publicConfig (env vars with
 * production fallbacks baked in) so a flaky NEXT_PUBLIC_* propagation
 * doesn't break the bundle.
 */
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
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
