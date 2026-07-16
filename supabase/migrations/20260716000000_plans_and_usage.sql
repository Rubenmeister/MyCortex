-- Planes y cuotas: hacer cumplir lo que /pricing ya promete públicamente
-- (Personal 500 nodos + 1 integración · Pro 50.000 nodos + todas · Team +RBAC)
-- y medir el uso de IA, que hoy NO tiene ningún tope.
--
-- SEGURIDAD (clave): ni el plan ni los contadores pueden ser escribibles por el
-- usuario. Con la anon key + su JWT podría auto-ascenderse a 'pro' o resetear su
-- cuota vía PostgREST. Por eso:
--   · workspaces.plan  → se revoca el UPDATE de ESA columna a `authenticated`.
--   · usage_counters   → sin grant de escritura; solo el service-role (que
--                        bypassea RLS) escribe desde la API.
--
-- NO APLICADA EN PROD todavía — aplicar cuando Rubén dé OK.

-- ---------- plan por workspace ----------
alter table public.workspaces
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'pro', 'team'));

-- GRANDFATHERING (importante): los workspaces que YA existen preceden a los
-- planes y no se limitan retroactivamente. Sin esto, el workspace de Rubén
-- (1.536 nodos > 500 del free, 3 integraciones > 1) quedaría bloqueado al
-- instante. Los NUEVOS signups sí nacen en 'free' (el default de arriba).
update public.workspaces set plan = 'pro' where plan = 'free';

-- El usuario puede editar su workspace (nombre, etc.) pero NO su plan.
revoke update (plan) on public.workspaces from authenticated;

-- ---------- contadores de uso ----------
-- Los nodos e integraciones NO se cuentan aquí: se derivan con un count() real
-- sobre sus tablas (siempre exacto, sin drift). Esta tabla es para consumo que
-- no se puede derivar: operaciones de IA por período.
create table if not exists public.usage_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period text not null,                       -- 'YYYY-MM' (mes calendario)
  metric text not null,                       -- 'ai_ops'
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, period, metric)
);

create index if not exists usage_counters_workspace_period_idx
  on public.usage_counters (workspace_id, period);

alter table public.usage_counters enable row level security;

-- Los miembros VEN su uso (para mostrarlo en la UI)…
drop policy if exists "members can read usage" on public.usage_counters;
create policy "members can read usage"
  on public.usage_counters for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = usage_counters.workspace_id and wm.user_id = auth.uid()
    )
  );

-- …pero NADIE lo escribe salvo el service-role (sin grant de insert/update).
grant select on public.usage_counters to authenticated;
grant select, insert, update on public.usage_counters to service_role;

-- Incremento atómico del contador (upsert + suma en una sola sentencia, sin
-- carreras). Lo llama la API con service-role.
create or replace function public.increment_usage(
  p_workspace_id uuid,
  p_period text,
  p_metric text,
  p_delta integer default 1
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.usage_counters (workspace_id, period, metric, count, updated_at)
  values (p_workspace_id, p_period, p_metric, p_delta, now())
  on conflict (workspace_id, period, metric) do update
    set count = public.usage_counters.count + p_delta,
        updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;

revoke all on function public.increment_usage(uuid, text, text, integer) from public, authenticated;
grant execute on function public.increment_usage(uuid, text, text, integer) to service_role;
