-- ============================================================
-- MyCortex initial schema
-- Nodes = atomic units of knowledge (notes, tasks, ideas, ...)
-- Multi-tenant via auth.users + RLS by user_id
-- pgvector for semantic search (1536 dims = OpenAI text-embedding-3-small)
-- ============================================================

create extension if not exists vector with schema extensions;

-- Enums
create type public.node_kind as enum ('note', 'task', 'idea', 'reference', 'fragment');
create type public.node_category as enum ('going', 'personal', 'urgent', 'unknown');
create type public.ingest_source as enum ('telegram', 'mobile', 'web', 'api');

-- Main table
create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.node_kind not null default 'note',
  category public.node_category not null default 'unknown',
  title text,
  content text not null,
  source public.ingest_source not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nodes_user_id_created_at_idx
  on public.nodes (user_id, created_at desc);

create index nodes_user_id_category_idx
  on public.nodes (user_id, category);

create index nodes_embedding_idx
  on public.nodes
  using hnsw (embedding extensions.vector_cosine_ops);

-- updated_at trigger
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger nodes_updated_at
  before update on public.nodes
  for each row execute function public.handle_updated_at();

-- Row Level Security
alter table public.nodes enable row level security;

create policy "users read own nodes"
  on public.nodes for select to authenticated
  using (auth.uid() = user_id);

create policy "users insert own nodes"
  on public.nodes for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users update own nodes"
  on public.nodes for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users delete own nodes"
  on public.nodes for delete to authenticated
  using (auth.uid() = user_id);

-- Semantic search RPC (cosine similarity, scoped per user)
create or replace function public.match_nodes(
  query_embedding extensions.vector(1536),
  query_user_id uuid,
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
  where user_id = query_user_id
    and embedding is not null
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
