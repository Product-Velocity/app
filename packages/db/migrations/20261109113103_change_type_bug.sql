-- Issue #364 follow-up. Ashu (2026-11-09): Change Type gets a third value, Bug, so the GitHub label `type:bug` has somewhere to go.
-- Replaces the check on items.change_type (New feature, Improvement to existing feature) with the same two values plus Bug.
-- Existing rows are unaffected (every current value is still allowed). Forward-only; no data change.
alter table public.items drop constraint if exists items_change_type_check;
alter table public.items add constraint items_change_type_check check (change_type in ('New feature', 'Improvement to existing feature', 'Bug'));
