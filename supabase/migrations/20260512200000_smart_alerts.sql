-- Smart alerts: real-time urgency detection on incoming content. The
-- cortex-alerts Cloud Run Job runs every 30 min, scans nodes created in
-- the last 60 min that haven't been classified yet, asks an LLM to flag
-- the ones that demand attention, and writes them here.
--
-- Different from daily_digests (those are morning synthesis); alerts
-- are "act on this NOW". The UI surfaces them with a badge in the nav.

create table if not exists public.smart_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  -- The source node that triggered the alert. on delete cascade so we
  -- don't leak alerts pointing to deleted content.
  node_id uuid not null references public.nodes(id) on delete cascade,
  -- Urgency level. critical = act today; high = act this week; low = FYI.
  level text not null check (level in ('critical', 'high', 'low')),
  -- 1-line headline shown in the UI list.
  title text not null,
  -- LLM-extracted concrete action ("Responder mail de X confirmando Y").
  action text not null,
  -- ISO timestamp if a deadline is mentioned in the source; null otherwise.
  deadline timestamptz,
  -- Short snippet from the source for context (60-120 chars).
  context text,
  -- User actions. Mutually exclusive in practice, but kept as 3 columns
  -- so we can show "you marked this as done on <date>" in the audit log.
  read_at timestamptz,
  dismissed_at timestamptz,
  acted_on_at timestamptz,
  created_at timestamptz not null default now(),
  -- One alert per (workspace, node). The worker is idempotent: skips
  -- nodes that already have a row here.
  unique (workspace_id, node_id)
);

-- Hot path: workspace's unread/unacted alerts ordered by level then time.
create index if not exists smart_alerts_workspace_open_idx
  on public.smart_alerts (workspace_id, level, created_at desc)
  where dismissed_at is null and acted_on_at is null;

create index if not exists smart_alerts_workspace_created_idx
  on public.smart_alerts (workspace_id, created_at desc);

alter table public.smart_alerts enable row level security;

drop policy if exists "members can read alerts" on public.smart_alerts;
create policy "members can read alerts"
  on public.smart_alerts
  for select
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = smart_alerts.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update alerts" on public.smart_alerts;
create policy "members can update alerts"
  on public.smart_alerts
  for update
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = smart_alerts.workspace_id
        and wm.user_id = auth.uid()
    )
  );

grant select, update on public.smart_alerts to authenticated;
