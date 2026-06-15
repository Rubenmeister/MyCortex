-- Puente Going <-> MyCortex: briefing ejecutivo de fundador. El worker
-- going-bridge ingesta señales de Going (deploys, CI, incidentes, seguridad, PRs)
-- como nodos (external_source='going'); este briefing los sintetiza para que
-- MyCortex sea también el cerebro ejecutivo del negocio.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.executive_briefings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  summary text not null,
  health text not null default '',
  risks text[] not null default '{}',
  priorities text[] not null default '{}',
  signals_analyzed int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists executive_briefings_workspace_created_idx
  on public.executive_briefings (workspace_id, created_at desc);

alter table public.executive_briefings enable row level security;

drop policy if exists "members can read executive_briefings" on public.executive_briefings;
create policy "members can read executive_briefings"
  on public.executive_briefings for select
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = executive_briefings.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can insert executive_briefings" on public.executive_briefings;
create policy "members can insert executive_briefings"
  on public.executive_briefings for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.workspace_members wm
      where wm.workspace_id = executive_briefings.workspace_id and wm.user_id = auth.uid())
  );

grant select, insert on public.executive_briefings to authenticated;
