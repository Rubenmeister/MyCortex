import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Lee TODAS las migraciones y verifica el invariante multi-tenant más importante:
// cada tabla en public tiene RLS habilitada Y al menos una policy. Es lo único
// que aísla los datos entre clientes; un olvido acá filtra datos entre cuentas.

const MIG_DIR = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIG_DIR, f), 'utf8'))
  .join('\n')
  .toLowerCase();

// Tablas exentas de RLS por diseño (ninguna por ahora — todo es tenant-scoped).
const RLS_EXEMPT = new Set<string>([]);

const tables = [
  ...new Set([...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]!)),
];

describe('RLS / aislamiento multi-tenant', () => {
  it('detecta tablas en las migraciones', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  for (const t of tables) {
    if (RLS_EXEMPT.has(t)) continue;

    it(`${t}: RLS habilitada`, () => {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    });

    it(`${t}: tiene al menos una policy`, () => {
      expect(sql).toMatch(new RegExp(`create policy [^;]+ on public\\.${t}\\b`));
    });
  }
});
