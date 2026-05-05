import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export type Db = SupabaseClient<Database>;

/** Service-role client. Bypasses RLS — use for admin operations only. */
export function createDb(url: string, key: string): Db {
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Per-request user-scoped client. Uses the anon/publishable key for the
 * apikey header and the user's JWT for Authorization. RLS enforces user
 * isolation at the database level.
 */
export function createUserDb(url: string, anonKey: string, jwt: string): Db {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export type { Database } from './types.js';
