-- Initiative Status gets Completed back (issue #247 follow-up, Ashu 2026-10-29): Active | On hold | Completed | Cancelled.
-- 20261028225223 left finished initiatives with a blank status ("Completed comes from the phase"); a blank reads as unknown.
-- Completed is set by people; this migration only fills it for initiatives whose phase already says the lifecycle is over
-- (Completed or Sunset) and whose status is blank. The update is audited like any other.
alter table public.items drop constraint items_initiative_status_check;
alter table public.items add constraint items_initiative_status_check
  check (initiative_status is null or initiative_status in ('Active', 'On hold', 'Completed', 'Cancelled'));
update public.items set initiative_status = 'Completed'
 where initiative_status is null and initiative_phase in ('Completed', 'Sunset');
