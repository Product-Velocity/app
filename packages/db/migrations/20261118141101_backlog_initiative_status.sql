-- Issue #504. Ashu (2026-11-18): Initiative Status gets a fifth value, Backlog (not started, parked): Backlog | Active | On hold | Completed | Cancelled.
-- docs/decisions/2026-11-18-initiative-status-backlog.md. Forward-only; no data change; every current value stays allowed.
alter table public.items drop constraint if exists items_initiative_status_check;
alter table public.items add constraint items_initiative_status_check
  check (initiative_status is null or initiative_status in ('Backlog', 'Active', 'On hold', 'Completed', 'Cancelled'));
