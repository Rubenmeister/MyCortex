-- Coach proactivo: persistencia de las sugerencias de crecimiento. El worker
-- cortex-coach corre semanalmente, genera sugerencias por workspace y las
-- guarda acá con ciclo de vida (pending/done/dismissed/snoozed) para habilitar
-- el SEGUIMIENTO ("la semana pasada te sugerí X, ¿avanzaste?").
--
-- coach_runs agrupa una corrida (focus + summary de esa semana); cada sugerencia
-- referencia su run. Espeja el patrón evolution_runs / evolution_actions.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.coach_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  focus text not null,
  summary text not null,
  nodes_analyzed int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists coach_runs_workspace_created_idx
  on public.coach_runs (workspace_id, created_at desc);

create table if not exists public.coach_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  run_id uuid references public.coach_runs(id) on delete set null,
  domain text not null,
  title text not null,
  insight text not null,
  action text not null,
  horizon text not null check (horizon in ('hoy', 'esta-semana', 'este-mes')),
  priority text not null default 'media' check (priority in ('alta', 'media', 'baja')),
  source_node_ids uuid[] not null default '{}',
  -- Ciclo de vida para el seguimiento.
  status text not null default 'pending'
    check (status in ('pending', 'done', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  read_at timestamptz,
  done_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coach_suggestions_workspace_open_idx
  on public.coach_suggestions (workspace_id, priority, created_at desc)
  where status = 'pending';

create index if not exists coach_suggestions_workspace_created_idx
  on public.coach_suggestions (workspace_id, created_at desc);

alter table public.coach_runs enable row level security;
alter table public.coach_suggestions enable row level security;

drop policy if exists "members can read coach_runs" on public.coach_runs;
create policy "members can read coach_runs"
  on public.coach_runs for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_runs.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can read coach_suggestions" on public.coach_suggestions;
create policy "members can read coach_suggestions"
  on public.coach_suggestions for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_suggestions.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert coach_suggestions" on public.coach_suggestions;
create policy "members can insert coach_suggestions"
  on public.coach_suggestions for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_suggestions.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update coach_suggestions" on public.coach_suggestions;
create policy "members can update coach_suggestions"
  on public.coach_suggestions for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_suggestions.workspace_id and wm.user_id = auth.uid()
    )
  );

grant select on public.coach_runs to authenticated;
grant select, insert, update on public.coach_suggestions to authenticated;
