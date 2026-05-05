-- ============================================================
-- Capa de Evolución (Cortex layer)
-- evolution_runs: one row per cron execution per user
-- evolution_actions: one row per suggested fusion action
-- Cron worker (service role) writes; users SELECT/UPDATE their own.
-- ============================================================

create table public.evolution_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','failed')),
  nodes_examined int not null default 0,
  clusters_found int not null default 0,
  actions_count int not null default 0,
  summary text,
  error text
);

create index evolution_runs_user_id_started_at_idx
  on public.evolution_runs (user_id, started_at desc);

alter table public.evolution_runs enable row level security;

create policy "users read own runs"
  on public.evolution_runs for select to authenticated
  using (auth.uid() = user_id);

create table public.evolution_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.evolution_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('merge','complement','correct','skip')),
  target_node_id uuid not null references public.nodes(id) on delete cascade,
  source_node_ids uuid[] not null default '{}',
  reasoning text,
  suggested_content text,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index evolution_actions_run_id_idx
  on public.evolution_actions (run_id);

create index evolution_actions_user_id_pending_idx
  on public.evolution_actions (user_id, created_at desc)
  where applied_at is null;

alter table public.evolution_actions enable row level security;

create policy "users read own actions"
  on public.evolution_actions for select to authenticated
  using (auth.uid() = user_id);

create policy "users mark own actions applied"
  on public.evolution_actions for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
