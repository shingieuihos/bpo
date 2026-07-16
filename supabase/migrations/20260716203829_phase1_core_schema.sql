-- ============================================================================
-- ForgeOS Phase 1 — core schema
-- 11 org-scoped tables, RLS on EVERY table, pgvector for the RAG corpus,
-- a signup trigger that provisions a personal organization, and explicit
-- Data API grants (new Supabase projects no longer auto-expose public tables).
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists vector with schema extensions;

-- ── Private schema ──────────────────────────────────────────────────────────
-- Security-definer helpers live here so they are never exposed via the API.
create schema if not exists private;
grant usage on schema private to authenticated;

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.org_role as enum ('owner', 'admin', 'member');
create type public.opportunity_source as enum
  ('marketplace_api', 'alert_email', 'owned_inbound', 'outbound');
create type public.opportunity_status as enum
  ('new', 'scored', 'drafting', 'proposed', 'won', 'lost', 'archived');
create type public.proposal_status as enum ('draft', 'approved', 'sent', 'archived');
create type public.proposal_outcome as enum
  ('pending', 'reply', 'shortlisted', 'won', 'lost', 'no_response');
create type public.deal_stage as enum
  ('qualifying', 'negotiation', 'contract_sent', 'won', 'lost');
create type public.asset_type as enum
  ('case_study', 'winning_proposal', 'pricing_framework', 'tone_sample');
create type public.assignee_type as enum ('ai', 'contractor');
create type public.delivery_job_status as enum
  ('draft', 'in_progress', 'qa', 'delivered', 'cancelled');
create type public.qa_status as enum ('pending', 'passed', 'rework');
-- POPIA-aware record classification (clients default to personal_data).
create type public.data_classification as enum
  ('general', 'personal_data', 'special_personal_data');

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organizations is 'Tenant boundary. Every business row hangs off an org.';

create table public.org_members (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
comment on table public.org_members is 'Supabase Auth users mapped to orgs with a per-org role.';

create table public.niches (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  name              text not null,
  pricing_model     text,
  target_margin     numeric(5,2) check (target_margin between 0 and 100),
  sop_ref           text,
  positioning_notes text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, name)
);
comment on table public.niches is 'Service-line config that drives ingestion filters, scoring, and delivery SOPs.';

create table public.opportunities (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  source                 public.opportunity_source not null,
  source_ref             text,
  raw_payload            jsonb,
  niche_id               uuid references public.niches (id) on delete set null,
  title                  text not null,
  description            text,
  budget                 numeric(12,2),
  currency               char(3) not null default 'USD',
  url                    text,
  status                 public.opportunity_status not null default 'new',
  -- Scoring fields, filled asynchronously in Phase 3.
  fit_score              smallint check (fit_score between 0 and 100),
  margin_potential_score smallint check (margin_potential_score between 0 and 100),
  urgency_score          smallint check (urgency_score between 0 and 100),
  effort_score           smallint check (effort_score between 0 and 100),
  score_rationale        text,
  scored_at              timestamptz,
  is_seed                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on column public.opportunities.is_seed is 'True for seed/mock rows so reporting can exclude them.';

create table public.proposals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  draft          text,
  final          text,
  status         public.proposal_status not null default 'draft',
  approved_by    uuid references auth.users (id) on delete set null,
  sent_at        timestamptz,
  outcome        public.proposal_outcome not null default 'pending',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.proposals is 'AI drafts a proposal; a human edits, approves, and sends it. The approval gate (Phase 4) is the ONLY path to status=sent.';

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  name                text not null,
  contact             jsonb not null default '{}',
  source              text,
  first_won_at        timestamptz,
  notes               text,
  data_classification public.data_classification not null default 'personal_data',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on column public.clients.data_classification is 'POPIA-aware marker; client contact records default to personal_data.';

create table public.deals (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  opportunity_id          uuid references public.opportunities (id) on delete set null,
  client_id               uuid references public.clients (id) on delete set null,
  stage                   public.deal_stage not null default 'qualifying',
  value                   numeric(12,2),
  currency                char(3) not null default 'USD',
  estimated_delivery_cost numeric(12,2),
  actual_delivery_cost    numeric(12,2),
  gross_margin            numeric(12,2) generated always as
                            (value - coalesce(actual_delivery_cost, estimated_delivery_cost)) stored,
  win_probability         smallint check (win_probability between 0 and 100),
  next_action_at          timestamptz,
  next_action_note        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on column public.deals.gross_margin is 'value minus actual delivery cost when known, else estimated (Phase 6 fills actuals).';

create table public.assets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  type       public.asset_type not null,
  title      text not null,
  content    text not null,
  -- 1536 dims (common embedding size). Provider is chosen in Phase 4; the
  -- vector index is added there too — embeddings stay NULL until then.
  embedding  extensions.vector(1536),
  niche_id   uuid references public.niches (id) on delete set null,
  is_seed    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.assets is 'RAG corpus grounding proposal drafts: case studies, winning proposals, pricing frameworks, tone samples.';

create table public.delivery_jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  deal_id       uuid not null references public.deals (id) on delete cascade,
  brief         text,
  tasks         jsonb not null default '[]',
  assignee_type public.assignee_type,
  assignee_ref  text,
  status        public.delivery_job_status not null default 'draft',
  qa_status     public.qa_status not null default 'pending',
  qa_notes      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.delivery_jobs.qa_status is 'QA gate: a job cannot be delivered until this is passed (enforced in Phase 6).';

create table public.contractors (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null,
  skills     text[] not null default '{}',
  rate       numeric(12,2),
  currency   char(3) not null default 'USD',
  rating     numeric(2,1) check (rating between 0 and 5),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  actor       uuid references auth.users (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
comment on table public.audit_events is 'Append-only. Every proposal approval/send writes here. No UPDATE/DELETE — enforced by RLS (no policies) AND revoked grants.';

-- ── Indexes (FKs + queue/report access paths; org_id aids RLS performance) ──
create index org_members_user_id_idx on public.org_members (user_id);
create index niches_org_id_idx on public.niches (org_id);
create index opportunities_org_status_idx on public.opportunities (org_id, status);
create index opportunities_org_created_idx on public.opportunities (org_id, created_at desc);
create index opportunities_niche_id_idx on public.opportunities (niche_id);
create index proposals_org_id_idx on public.proposals (org_id);
create index proposals_opportunity_id_idx on public.proposals (opportunity_id);
create index clients_org_id_idx on public.clients (org_id);
create index deals_org_stage_idx on public.deals (org_id, stage);
create index deals_org_next_action_idx on public.deals (org_id, next_action_at);
create index deals_opportunity_id_idx on public.deals (opportunity_id);
create index deals_client_id_idx on public.deals (client_id);
create index assets_org_type_idx on public.assets (org_id, type);
create index assets_niche_id_idx on public.assets (niche_id);
create index delivery_jobs_org_id_idx on public.delivery_jobs (org_id);
create index delivery_jobs_deal_id_idx on public.delivery_jobs (deal_id);
create index contractors_org_id_idx on public.contractors (org_id);
create index audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

-- ── Helper functions (private schema, security definer, pinned search_path) ─

-- Org ids the current user belongs to. SECURITY DEFINER so RLS policies can
-- consult org_members without recursive policy evaluation.
create or replace function private.user_org_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select org_id from public.org_members where user_id = (select auth.uid());
$$;
revoke all on function private.user_org_ids() from public, anon;
grant execute on function private.user_org_ids() to authenticated;

-- updated_at maintenance.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.org_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.niches
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.opportunities
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.proposals
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.assets
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.delivery_jobs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.contractors
  for each row execute function private.set_updated_at();

-- Provision a personal organization for every new auth user (single-operator
-- default; additional seats join existing orgs in later phases).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
begin
  insert into public.organizations (name)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'operator') || '''s workspace')
  returning id into new_org_id;

  insert into public.org_members (org_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Row Level Security: enabled on EVERY table ──────────────────────────────
alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.niches        enable row level security;
alter table public.opportunities enable row level security;
alter table public.proposals     enable row level security;
alter table public.clients       enable row level security;
alter table public.deals         enable row level security;
alter table public.assets        enable row level security;
alter table public.delivery_jobs enable row level security;
alter table public.contractors   enable row level security;
alter table public.audit_events  enable row level security;

-- organizations: members can see their orgs. Creation happens via the signup
-- trigger (definer) or service role only — no direct client writes in v1.
create policy "organizations_select" on public.organizations
  for select to authenticated
  using (id in (select private.user_org_ids()));

-- org_members: members can see membership of their own orgs. Managed by the
-- signup trigger / service role only in v1 — no direct client writes.
create policy "org_members_select" on public.org_members
  for select to authenticated
  using (org_id in (select private.user_org_ids()));

-- Business tables: org members get full CRUD within their org.
create policy "niches_select" on public.niches
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "niches_insert" on public.niches
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "niches_update" on public.niches
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "niches_delete" on public.niches
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "opportunities_select" on public.opportunities
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "opportunities_insert" on public.opportunities
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "opportunities_update" on public.opportunities
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "opportunities_delete" on public.opportunities
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "proposals_select" on public.proposals
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "proposals_insert" on public.proposals
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "proposals_update" on public.proposals
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "proposals_delete" on public.proposals
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "clients_select" on public.clients
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "clients_insert" on public.clients
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "clients_update" on public.clients
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "clients_delete" on public.clients
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "deals_select" on public.deals
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "deals_insert" on public.deals
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "deals_update" on public.deals
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "deals_delete" on public.deals
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "assets_select" on public.assets
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "assets_insert" on public.assets
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "assets_update" on public.assets
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "assets_delete" on public.assets
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "delivery_jobs_select" on public.delivery_jobs
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "delivery_jobs_insert" on public.delivery_jobs
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "delivery_jobs_update" on public.delivery_jobs
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "delivery_jobs_delete" on public.delivery_jobs
  for delete to authenticated using (org_id in (select private.user_org_ids()));

create policy "contractors_select" on public.contractors
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "contractors_insert" on public.contractors
  for insert to authenticated with check (org_id in (select private.user_org_ids()));
create policy "contractors_update" on public.contractors
  for update to authenticated
  using (org_id in (select private.user_org_ids()))
  with check (org_id in (select private.user_org_ids()));
create policy "contractors_delete" on public.contractors
  for delete to authenticated using (org_id in (select private.user_org_ids()));

-- audit_events: append-only — SELECT and INSERT only, no UPDATE/DELETE policies.
create policy "audit_events_select" on public.audit_events
  for select to authenticated using (org_id in (select private.user_org_ids()));
create policy "audit_events_insert" on public.audit_events
  for insert to authenticated with check (org_id in (select private.user_org_ids()));

-- ── Reporting view: client lifetime value (computed, not stored) ────────────
-- security_invoker so the caller's RLS applies to the underlying tables.
create view public.v_client_lifetime_value
  with (security_invoker = true) as
select
  c.id as client_id,
  c.org_id,
  c.name,
  coalesce(sum(d.value) filter (where d.stage = 'won'), 0) as lifetime_value,
  count(d.id) filter (where d.stage = 'won') as won_deals
from public.clients c
left join public.deals d on d.client_id = c.id
group by c.id, c.org_id, c.name;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- New Supabase projects no longer auto-expose public tables to the Data API,
-- so privileges are granted explicitly. anon gets NOTHING (internal app);
-- rows are still filtered by RLS for authenticated.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Belt & braces on top of RLS:
revoke update, delete on public.audit_events from authenticated;
revoke insert, update, delete on public.organizations from authenticated;
revoke insert, update, delete on public.org_members from authenticated;
