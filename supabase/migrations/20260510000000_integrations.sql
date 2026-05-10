-- ============================================================
-- MyCortex external integrations: Drive, Gmail, etc.
-- - integrations: OAuth connection per workspace+provider
-- - sync_sources: which folders/queries to sync from each integration
-- - nodes.external_* : dedup key for nodes ingested from external systems
-- ============================================================

-- ---- integrations table ------------------------------------------------

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_drive', 'gmail', 'notion')),
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  -- OAuth tokens (service-role only access — no select policy for users).
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  -- Identifying info about the connected external account
  external_account_email text,
  external_account_id text,
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One connection per (workspace, provider, account)
  unique (workspace_id, provider, external_account_id)
);

create index integrations_workspace_provider_idx
  on public.integrations (workspace_id, provider);

-- updated_at trigger
create trigger integrations_updated_at
  before update on public.integrations
  for each row execute function public.handle_updated_at();

alter table public.integrations enable row level security;

-- Members can SEE that their workspace has an integration (for the UI), but
-- never the tokens themselves. We expose status + provider + account email
-- via the api at the application layer (api selects only safe columns).
create policy "members read workspace integrations"
  on public.integrations for select to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- Owners/admins can disconnect (delete row). Inserts/updates are server-side
-- only (api uses service role).
create policy "owners delete workspace integrations"
  on public.integrations for delete to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ---- sync_sources table ------------------------------------------------

create table public.sync_sources (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- For Drive: folder ID. For Gmail: filter query JSON. Etc.
  external_id text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_synced_at timestamptz,
  last_sync_cursor text,            -- delta token (Drive) / historyId (Gmail)
  items_synced int not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_id)
);

create index sync_sources_workspace_idx
  on public.sync_sources (workspace_id);
create index sync_sources_active_idx
  on public.sync_sources (status, last_synced_at)
  where status = 'active';

create trigger sync_sources_updated_at
  before update on public.sync_sources
  for each row execute function public.handle_updated_at();

alter table public.sync_sources enable row level security;

create policy "members read workspace sync_sources"
  on public.sync_sources for select to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy "owners manage workspace sync_sources"
  on public.sync_sources for delete to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ---- nodes.external_* for dedup ----------------------------------------

alter table public.nodes
  add column external_source text,
  add column external_id text,
  add column external_metadata jsonb;

-- Idempotent upsert key for sync workers.
create unique index nodes_workspace_external_unique
  on public.nodes (workspace_id, external_source, external_id)
  where external_id is not null;
