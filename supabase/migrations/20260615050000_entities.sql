-- Grafo navegable de entidades: personas, proyectos, organizaciones, lugares y
-- temas extraídos del material, con sus menciones (entity <-> node). Habilita
-- "mostrame todo sobre X" y conexiones por co-ocurrencia.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  type text not null check (type in ('persona', 'proyecto', 'organizacion', 'lugar', 'tema', 'otro')),
  aliases text[] not null default '{}',
  summary text not null default '',
  mention_count int not null default 0,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index if not exists entities_workspace_mentions_idx
  on public.entities (workspace_id, mention_count desc);

create table if not exists public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (entity_id, node_id)
);

create index if not exists entity_mentions_entity_idx
  on public.entity_mentions (entity_id);
create index if not exists entity_mentions_node_idx
  on public.entity_mentions (node_id);

-- updated_at trigger en entities.
drop trigger if exists entities_updated_at on public.entities;
create trigger entities_updated_at
  before update on public.entities
  for each row execute function public.handle_updated_at();

alter table public.entities enable row level security;
alter table public.entity_mentions enable row level security;

-- entities: lectura/escritura por miembros.
drop policy if exists "members can read entities" on public.entities;
create policy "members can read entities"
  on public.entities for select
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = entities.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can insert entities" on public.entities;
create policy "members can insert entities"
  on public.entities for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.workspace_members wm
      where wm.workspace_id = entities.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can update entities" on public.entities;
create policy "members can update entities"
  on public.entities for update
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = entities.workspace_id and wm.user_id = auth.uid())
  );

-- entity_mentions: lectura/escritura por miembros del workspace.
drop policy if exists "members can read entity_mentions" on public.entity_mentions;
create policy "members can read entity_mentions"
  on public.entity_mentions for select
  using (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = entity_mentions.workspace_id and wm.user_id = auth.uid())
  );

drop policy if exists "members can insert entity_mentions" on public.entity_mentions;
create policy "members can insert entity_mentions"
  on public.entity_mentions for insert
  with check (
    exists (select 1 from public.workspace_members wm
      where wm.workspace_id = entity_mentions.workspace_id and wm.user_id = auth.uid())
  );

grant select, insert, update on public.entities to authenticated;
grant select, insert on public.entity_mentions to authenticated;
