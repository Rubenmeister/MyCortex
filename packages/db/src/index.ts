import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export type Db = SupabaseClient<Database>;

export function createDb(url: string, key: string): Db {
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}

export type { Database } from './types.js';
