-- ============================================================================
-- ForgeOS Phase 3 — scoring support
-- 1. organizations.settings: operator-tunable config (scoring weights first).
-- 2. Move the queue-claim function to the public schema so the service-role
--    worker can call it via PostgREST RPC (private schema is not exposed).
--    EXECUTE is service_role-only; SECURITY INVOKER (service_role bypasses
--    RLS on its own — no definer privileges needed).
-- ============================================================================

alter table public.organizations add column settings jsonb not null default '{}';
comment on column public.organizations.settings is
  'Operator-tunable config. settings.scoring_weights = {fit, margin, urgency, effort} integer percents used to rank the opportunity queue.';

drop function private.claim_queue_jobs(text, int);

create or replace function public.claim_queue_jobs(p_job_type text, p_limit int)
returns setof public.job_queue
language sql
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

revoke all on function public.claim_queue_jobs(text, int) from public, anon, authenticated;
grant execute on function public.claim_queue_jobs(text, int) to service_role;
