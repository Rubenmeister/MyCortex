-- ============================================================
-- Workspaces (multi-tenant foundation)
-- A node belongs to a workspace, not directly to a user. Every user
-- gets a personal workspace on signup. RLS enforces membership.
-- ============================================================

-- 1. Workspaces table
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  is_personal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

-- 2. Workspace members (junction table)
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- 3. Add workspace_id to existing tables (nullable for backfill)
alter table public.nodes add column workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.evolution_runs add column workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.evolution_actions add column workspace_id uuid references public.workspaces(id) on delete cascade;

-- 4. Backfill: create a personal workspace for every existing user, then
-- attach existing rows to it. Done in two passes:
--   4a. users that already have nodes (typical case)
--   4b. users in auth.users that have no nodes yet (rare, but defensive)
do $$
declare
  u_id uuid;
  ws_id uuid;
begin
  for u_id in (select distinct user_id from public.nodes) loop
    insert into public.workspaces (name, slug, owner_id, is_personal)
    values ('Personal', 'personal-' || substr(u_id::text, 1, 8), u_id, true)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, u_id, 'owner');

    update public.nodes set workspace_id = ws_id where user_id = u_id;
    update public.evolution_runs set workspace_id = ws_id where user_id = u_id;
    update public.evolution_actions set workspace_id = ws_id where user_id = u_id;
  end loop;
end $$;

do $$
declare
  u record;
  ws_id uuid;
begin
  for u in (
    select id, email from auth.users
    where id not in (
      select owner_id from public.workspaces where is_personal = true
    )
  ) loop
    insert into public.workspaces (name, slug, owner_id, is_personal)
    values (
      coalesce(u.email, 'Personal'),
      'personal-' || substr(u.id::text, 1, 8),
      u.id,
      true
    )
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, u.id, 'owner');
  end loop;
end $$;

-- 5. Now make workspace_id NOT NULL on existing tables
alter table public.nodes        alter column workspace_id set not null;
alter table public.evolution_runs    alter column workspace_id set not null;
alter table public.evolution_actions alter column workspace_id set not null;

-- 6. Helpful indexes
create index nodes_workspace_id_created_at_idx
  on public.nodes (workspace_id, created_at desc);

create index evolution_runs_workspace_id_started_idx
  on public.evolution_runs (workspace_id, started_at desc);

create index evolution_actions_workspace_id_idx
  on public.evolution_actions (workspace_id, created_at desc);

-- 7. Drop old per-user RLS, replace with workspace-membership RLS
drop policy if exists "users read own nodes"    on public.nodes;
drop policy if exists "users insert own nodes"  on public.nodes;
drop policy if exists "users update own nodes"  on public.nodes;
drop policy if exists "users delete own nodes"  on public.nodes;

create policy "members read workspace nodes"
  on public.nodes for select to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy "members insert workspace nodes"
  on public.nodes for insert to authenticated
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin','member')
    )
  );

create policy "members update workspace nodes"
  on public.nodes for update to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin','member')
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin','member')
    )
  );

create policy "members delete workspace nodes"
  on public.nodes for delete to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin','member')
    )
  );

-- evolution_runs: read own workspace; service role inserts/updates
drop policy if exists "users read own runs" on public.evolution_runs;
create policy "members read workspace runs"
  on public.evolution_runs for select to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- evolution_actions: read own workspace; member+ can mark applied
drop policy if exists "users read own actions"          on public.evolution_actions;
drop policy if exists "users mark own actions applied"  on public.evolution_actions;
create policy "members read workspace actions"
  on public.evolution_actions for select to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );
create policy "members mark workspace actions applied"
  on public.evolution_actions for update to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin','member')
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin','member')
    )
  );

-- 8. RLS for the new tables themselves
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members read their workspaces"
  on public.workspaces for select to authenticated
  using (
    id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy "owners update their workspaces"
  on public.workspaces for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- IMPORTANT: avoid self-referential policies on workspace_members. Any SELECT
-- policy that does `workspace_id in (select ... from workspace_members ...)`
-- triggers infinite recursion when a parent table's RLS subqueries this table
-- (which is the whole point — nodes/evolution_runs/evolution_actions all
-- pivot through workspace_members). Keep SELECT trivial; split owner write
-- privileges into specific commands.

create policy "users read own memberships"
  on public.workspace_members for select to authenticated
  using (user_id = auth.uid());

create policy "owners insert memberships"
  on public.workspace_members for insert to authenticated
  with check (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

create policy "owners update memberships"
  on public.workspace_members for update to authenticated
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  )
  with check (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

create policy "owners delete memberships"
  on public.workspace_members for delete to authenticated
  using (
    workspace_id in (select id from public.workspaces where owner_id = auth.uid())
  );

-- 9. Trigger: auto-create personal workspace on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name, slug, owner_id, is_personal)
  values (
    coalesce(new.email, 'Personal'),
    'personal-' || substr(new.id::text, 1, 8),
    new.id,
    true
  )
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 10. Update match_nodes RPC: scope by workspace, not user.
-- Drop the old signature first (Postgres distinguishes by arg types).
drop function if exists public.match_nodes(extensions.vector, uuid, int, float);

create or replace function public.match_nodes(
  query_embedding extensions.vector(1536),
  query_workspace_id uuid,
  match_count int default 10,
  match_threshold float default 0.7
)
returns table (
  id uuid,
  content text,
  category public.node_category,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    category,
    1 - (embedding <=> query_embedding) as similarity
  from public.nodes
  where workspace_id = query_workspace_id
    and embedding is not null
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
