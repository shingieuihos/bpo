-- ============================================================================
-- ForgeOS Phase 4 — RAG retrieval support
-- 1. assets.embedding becomes dimension-flexible (provider chosen via env;
--    Voyage=1024, OpenAI=1536 — the column accepts either; rows all NULL so
--    the type change is free). embedding_model records what produced it.
-- 2. match_assets(): cosine-ranked retrieval over the caller's own assets
--    (SECURITY INVOKER — RLS applies), niche-boosted.
--    No vector index yet: the corpus is tiny; add HNSW when it grows and the
--    provider/dimension is locked in.
-- ============================================================================

alter table public.assets alter column embedding type extensions.vector;
alter table public.assets add column embedding_model text;
comment on column public.assets.embedding_model is
  'Embedding provider/model that produced `embedding` (e.g. voyage:voyage-3.5). NULL = not embedded; mismatches with the configured provider trigger re-embedding via npm run embed.';

create or replace function public.match_assets(
  p_org_id uuid,
  p_embedding extensions.vector,
  p_niche_id uuid default null,
  p_limit int default 6
)
returns table (
  id uuid,
  type public.asset_type,
  title text,
  content text,
  niche_id uuid,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  select
    a.id, a.type, a.title, a.content, a.niche_id,
    -- Cosine similarity, nudged up for niche-specific assets. The operator is
    -- schema-qualified because the function pins an empty search_path.
    (1 - (a.embedding OPERATOR(extensions.<=>) p_embedding))
      + case when p_niche_id is not null and a.niche_id = p_niche_id then 0.05 else 0 end
      as similarity
  from public.assets a
  where a.org_id = p_org_id
    and a.embedding is not null
  order by similarity desc
  limit p_limit;
$$;

revoke all on function public.match_assets(uuid, extensions.vector, uuid, int) from public, anon;
grant execute on function public.match_assets(uuid, extensions.vector, uuid, int) to authenticated, service_role;
