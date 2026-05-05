import { createDb, type Db } from '@mycortex/db';
import { getEnv } from './env.js';

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const env = getEnv();
  cached = createDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return cached;
}
