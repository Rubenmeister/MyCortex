-- Puente multi-tenant: fuentes de negocio por workspace. Cada cliente conecta
-- SU propio repo (y token si es privado) desde la UI, en lugar del cableado por
-- env vars del worker. El worker going-bridge itera estas filas (todas las
-- cuentas) en vez de una sola config fija.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` / SQL Editor cuando
-- Rubén dé OK.

create table if not exists public.bridge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  provider text not null default 'github' check (provider in ('github')),
  -- "owner/repo".
  repo text not null,
  -- PAT de GitHub; null para repos públicos. Mismo modelo que integrations.access_token.
  access_token text,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, repo)
);

create index if not exists bridge_sources_workspace_idx
  on public.bridge_sources (workspace_id);
create index if not exists bridge_sources_active_idx
  on public.bridge_sources (status) where status = 'active';

drop trigger if exists bridge_sources_updated_at on public.bridge_sources;
create trigger bridge_sources_updated_at
  before update on public.bridge_sources
  for each row execute function public.handle_updated_at();

alter table public.bridge_sources enable row level security;

drop policy if exists "members can read bridge_sources" on public.bridge_sources;
create policy "members can read bridge_sources"
  on public.bridge_sources for select
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = bridge_sources.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can insert bridge_sources" on public.bridge_sources;
create policy "members can insert bridge_sources"
  on public.bridge_sources for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.workspace_members wm
      where wm.workspace_id = bridge_sources.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can update bridge_sources" on public.bridge_sources;
create policy "members can update bridge_sources"
  on public.bridge_sources for update
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = bridge_sources.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can delete bridge_sources" on public.bridge_sources;
create policy "members can delete bridge_sources"
  on public.bridge_sources for delete
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = bridge_sources.workspace_id and wm.user_id = auth.uid())
  );

grant select, insert, update, delete on public.bridge_sources to authenticated;
