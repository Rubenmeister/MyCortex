-- Daily digests: each morning a Cloud Run Job summarizes the last 24h of
-- the user's second brain (new emails, new docs, today's calendar events)
-- and stores the brief here for the web page + Telegram push to consume.

create table if not exists public.daily_digests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  -- The date this digest is FOR (i.e. the morning briefing of <for_date>).
  -- Combined with workspace_id this is the natural unique key — one
  -- digest per workspace per day; if the worker re-runs it overwrites.
  for_date date not null,
  -- Long-form LLM-generated summary, markdown. Renders in the web view.
  summary text not null,
  -- Structured breakdown for richer rendering: each section has a title,
  -- bullets, and references back to source nodes.
  sections jsonb not null default '[]'::jsonb,
  -- How many items each surface contributed to this digest. Useful for
  -- the "Today: 3 emails, 2 events, 1 doc" header.
  counts jsonb not null default '{}'::jsonb,
  -- Generation diagnostics: which LLM, latency, token count, errors.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, for_date)
);

create index if not exists daily_digests_workspace_date_idx
  on public.daily_digests (workspace_id, for_date desc);

-- RLS: only workspace members can read their digests. No write access from
-- the client — the worker uses service_role to insert.
alter table public.daily_digests enable row level security;

drop policy if exists "members can read digests" on public.daily_digests;
create policy "members can read digests"
  on public.daily_digests
  for select
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = daily_digests.workspace_id
        and wm.user_id = auth.uid()
    )
  );

grant select on public.daily_digests to authenticated;
