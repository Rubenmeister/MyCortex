import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Cada tabla creada en una migración debe estar registrada en el tipo Database
// (packages/db/src/types.ts). Si falta, el cliente tipado de Supabase la trata
// como inexistente y las queries fallan en runtime (db_error). Esto lo atrapa.

const MIG_DIR = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIG_DIR, f), 'utf8'))
  .join('\n');

const tables = [
  ...new Set([...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]!)),
];

const typesSrc = readFileSync(join(process.cwd(), 'packages', 'db', 'src', 'types.ts'), 'utf8');

describe('db types cubren las migraciones', () => {
  for (const t of tables) {
    it(`${t}: registrada en Database.Tables`, () => {
      expect(typesSrc).toMatch(new RegExp(`\\b${t}:\\s*\\{`));
    });
  }
});
