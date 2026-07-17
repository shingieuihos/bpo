-- ============================================================================
-- ForgeOS Phase 7 — cash timing needs to know WHEN deals were won.
-- (updated_at mutates on any edit, so it can't anchor revenue timelines.)
-- ============================================================================

alter table public.deals add column won_at timestamptz;
comment on column public.deals.won_at is
  'Stamped by the mark-won flow; anchors cash-timing reporting.';

-- Backfill any already-won deals with their last update as the best estimate.
update public.deals set won_at = updated_at where stage = 'won' and won_at is null;
