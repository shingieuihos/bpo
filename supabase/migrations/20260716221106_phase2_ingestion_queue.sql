-- ============================================================================
-- ForgeOS Phase 2 — ingestion dedup + async job queue
-- 1. Dedup guarantees on opportunities (hard unique refs + content hash).
-- 2. job_queue: lightweight async queue consumed by server-side workers
--    (Phase 2 enqueues scoring jobs; Phase 3 processes them).
-- ============================================================================

-- ── Opportunity dedup ───────────────────────────────────────────────────────
-- Content-hash fallback for sources that lack a stable external ref.
alter table public.opportunities add column dedup_key text;
comment on column public.opportunities.dedup_key is
  'sha256 of normalized (source, title, url, budget) — dedup fallback when the source provides no stable ref.';

-- Hard dedup: same external ref can only be ingested once per org+source.
create unique index opportunities_org_source_ref_key
  on public.opportunities (org_id, source, source_ref)
  where source_ref is not null;

-- Soft dedup: identical normalized content can only be ingested once per org.
create unique index opportunities_org_dedup_key
  on public.opportunities (org_id, dedup_key)
  where dedup_key is not null;

-- ── Async job queue ─────────────────────────────────────────────────────────
create type public.queue_job_status as enum
  ('pending', 'processing', 'done', 'failed');

create table public.job_queue (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  job_type     text not null,
  payload      jsonb not null default '{}',
  status       public.queue_job_status not null default 'pending',
  attempts     smallint not null default 0,
  max_attempts smallint not null default 5,
  run_after    timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.job_queue is
  'Lightweight async queue. Workers run server-side with the service role and claim jobs via private.claim_queue_jobs(); retries use attempts/run_after backoff.';

create index job_queue_claim_idx
  on public.job_queue (status, run_after)
  where status in ('pending', 'processing');
create index job_queue_org_idx on public.job_queue (org_id);

create trigger set_updated_at before update on public.job_queue
  for each row execute function private.set_updated_at();

-- Atomic claim for workers: flips up to p_limit due jobs to 'processing' and
-- returns them. SKIP LOCKED keeps concurrent workers from double-claiming.
-- Lives in the unexposed private schema; only the service role executes it.
create or replace function private.claim_queue_jobs(p_job_type text, p_limit int)
returns setof public.job_queue
language sql
security definer
set search_path = ''
as $$
  update public.job_queue q
  set status = 'processing',
      attempts = q.attempts + 1,
      updated_at = now()
  where q.id in (
    select id from public.job_queue
    where status = 'pending'
      and job_type = p_job_type
      and run_after <= now()
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning q.*;
$$;
revoke all on function private.claim_queue_jobs(text, int) from public, anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.job_queue enable row level security;

-- Org members may observe their org's queue; all writes happen server-side
-- with the service role (no insert/update/delete policies for authenticated).
create policy "job_queue_select" on public.job_queue
  for select to authenticated using (org_id in (select private.user_org_ids()));

-- ── Grants ──────────────────────────────────────────────────────────────────
grant select on public.job_queue to authenticated;
grant all on public.job_queue to service_role;
