-- 20261105160035_phase_values_test_completed: Initiative Phase values become Discover, Define, Build, Test, Experiment, Roll-out, Completed (issue #323,
-- docs/decisions/2026-11-05-lifecycle-and-gates.md). Beta-test is renamed Test (label only: the start_beta and time_beta_days keys stay) and Sunset is removed
-- (its rows become Completed). The phase start date and phase_changed_at of existing rows are not touched by the rename.
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- Replaces the whole function public.items_system_fields (only migration 0009 defines it; no open branch changes it).

alter table public.items disable trigger items_d_system;

alter table public.items drop constraint if exists items_initiative_phase_check;
update public.items set initiative_phase = 'Test' where initiative_phase = 'Beta-test';
update public.items set initiative_phase = 'Completed' where initiative_phase = 'Sunset';
-- a finished initiative whose status was still blank reads as Completed (the status leads from now on, the phase follows)
update public.items set initiative_status = 'Completed' where initiative_phase = 'Completed' and initiative_status is null;
alter table public.items add constraint items_initiative_phase_check
  check (initiative_phase in ('Discover', 'Define', 'Build', 'Test', 'Experiment', 'Roll-out', 'Completed'));

alter table public.items enable trigger items_d_system;

create or replace function public.items_system_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or coalesce(current_setting('pv.rank_internal', true), '') <> 'on' then
    new.last_edited_at := now();
    new.last_edited_by := auth.uid();
  end if;
  if (tg_op = 'INSERT' and new.initiative_phase is not null)
     or (tg_op = 'UPDATE' and new.initiative_phase is distinct from old.initiative_phase) then
    new.phase_changed_at := now();
    if new.initiative_phase = 'Discover' then new.start_discovery := coalesce(new.start_discovery, current_date);
    elsif new.initiative_phase = 'Define' then new.start_definition := coalesce(new.start_definition, current_date);
    elsif new.initiative_phase = 'Build' then new.start_building := coalesce(new.start_building, current_date);
    elsif new.initiative_phase = 'Test' then new.start_beta := coalesce(new.start_beta, current_date);
    elsif new.initiative_phase = 'Experiment' then new.start_experiment := coalesce(new.start_experiment, current_date);
    elsif new.initiative_phase = 'Roll-out' then new.start_rollout := coalesce(new.start_rollout, current_date);
    end if;
  end if;
  return new;
end $$;
