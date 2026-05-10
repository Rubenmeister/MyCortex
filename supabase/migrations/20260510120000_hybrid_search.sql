-- Hybrid search: combine vector similarity with Postgres FTS via Reciprocal
-- Rank Fusion. Returns rich source data (title, source, external_*,
-- created_at, metadata) so the frontend can cite where info comes from.
--
-- Background:
--   Pure vector similarity occasionally pulls in tangentially-related chunks
--   when the question has a distinctive keyword (a name, a number, an
--   acronym) that doesn't dominate the embedding. RRF combines the two
--   rankings with a damped sum (1 / (60 + rank)) so a chunk that's top-1
--   in either signal lands in the top results, but it has to be at least
--   plausible in BOTH signals to win.

-- ---- FTS support index ----------------------------------------------------
-- Build a tsvector index over title + content. We use 'simple' instead of
-- 'spanish' because user content is multilingual and 'simple' doesn't apply
-- a language-specific stemmer; with 'spanish' it would mishandle English
-- email subjects, etc. RRF compensates by combining with semantic search.
create index if not exists nodes_fts_idx
  on public.nodes
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));

-- ---- Hybrid search RPC -----------------------------------------------------
drop function if exists public.match_nodes_hybrid(extensions.vector, text, uuid, int, float);

create or replace function public.match_nodes_hybrid(
  query_embedding extensions.vector(1536),
  query_text text,
  query_workspace_id uuid,
  match_count int default 8,
  match_threshold float default 0.25
)
returns table (
  id uuid,
  title text,
  content text,
  category public.node_category,
  source public.ingest_source,
  external_source text,
  external_id text,
  external_metadata jsonb,
  created_at timestamptz,
  similarity float,
  keyword_score float,
  rrf_score float
)
language sql stable
as $$
  with
  vector_results as (
    select
      n.id,
      1 - (n.embedding <=> query_embedding) as sim,
      row_number() over (order by n.embedding <=> query_embedding) as rank
    from public.nodes n
    where n.workspace_id = query_workspace_id
      and n.embedding is not null
      and 1 - (n.embedding <=> query_embedding) > match_threshold
    order by n.embedding <=> query_embedding
    limit 20
  ),
  keyword_results as (
    select
      n.id,
      ts_rank_cd(
        to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.content, '')),
        websearch_to_tsquery('simple', query_text)
      ) as k_score,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.content, '')),
          websearch_to_tsquery('simple', query_text)
        ) desc
      ) as rank
    from public.nodes n
    where n.workspace_id = query_workspace_id
      and to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.content, ''))
          @@ websearch_to_tsquery('simple', query_text)
    limit 20
  ),
  combined as (
    select
      coalesce(v.id, k.id) as id,
      coalesce(v.sim, 0) as similarity,
      coalesce(k.k_score, 0) as keyword_score,
      coalesce(case when v.rank is not null then 1.0 / (60 + v.rank) else 0 end, 0)
        + coalesce(case when k.rank is not null then 1.0 / (60 + k.rank) else 0 end, 0)
        as rrf_score
    from vector_results v
    full outer join keyword_results k on v.id = k.id
  )
  select
    n.id,
    n.title,
    n.content,
    n.category,
    n.source,
    n.external_source,
    n.external_id,
    n.external_metadata,
    n.created_at,
    c.similarity,
    c.keyword_score,
    c.rrf_score
  from combined c
  join public.nodes n on n.id = c.id
  where c.rrf_score > 0
  order by c.rrf_score desc, c.similarity desc
  limit match_count;
$$;

grant execute on function public.match_nodes_hybrid(extensions.vector, text, uuid, int, float) to authenticated, service_role;
