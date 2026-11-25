-- Ashu (2026-11-25, issue #672): an initiative that becomes Completed has no Health (Help already said "blank"); reopening it puts the Health back.
-- docs/decisions/2026-11-25-completing-an-initiative.md. Forward-only; no data change. Replaces the whole function public.items_system_fields
-- (last defined in 20261118132442_sunset_phase_tech_debt). No other open branch changes it.

create or replace function public.items_system_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text;
  v_health text;
  v_phase_changed boolean;
begin
  if tg_op = 'INSERT' or coalesce(current_setting('pv.rank_internal', true), '') <> 'on' then
    new.last_edited_at := now();
    new.last_edited_by := auth.uid();
  end if;

  if tg_op = 'INSERT' and new.initiative_status = 'Completed' then
    if new.initiative_phase is distinct from 'Sunset' then new.initiative_phase := 'Completed'; end if;
    new.health := null;
  elsif tg_op = 'UPDATE' and new.initiative_status is distinct from old.initiative_status then
    if new.initiative_status = 'Completed' then
      if new.initiative_phase is distinct from 'Sunset' then new.initiative_phase := 'Completed'; end if;
      new.health := null; -- a finished initiative has no health; the old value stays in the audit log
    elsif old.initiative_status = 'Completed' then
      -- reopening puts back the Health that completing cleared (the audit entry written in the same transaction as the status change to Completed)
      if new.health is null then
        select a.old #>> '{}' into v_health from public.audit_log a
         where a.entity = 'items' and a.entity_id = new.id and a.field = 'health' and a.old is not null and a.old <> 'null'::jsonb and (a.new is null or a.new = 'null'::jsonb)
           and a.at = (select max(s.at) from public.audit_log s where s.entity = 'items' and s.entity_id = new.id and s.field = 'initiative_status' and s.new = to_jsonb('Completed'::text))
         order by a.id desc limit 1;
        new.health := v_health;
      end if;
    end if;
    if new.initiative_status is distinct from 'Completed' and old.initiative_status = 'Completed' and new.initiative_phase = 'Completed' then
      select a.old #>> '{}' into v_prev from public.audit_log a
       where a.entity = 'items' and a.entity_id = new.id and a.field = 'initiative_phase' and a.new = to_jsonb('Completed'::text)
       order by a.at desc, a.id desc limit 1;
      new.initiative_phase := nullif(v_prev, 'Completed');
    end if;
  end if;

  v_phase_changed := (tg_op = 'INSERT' and new.initiative_phase is not null)
    or (tg_op = 'UPDATE' and new.initiative_phase is distinct from old.initiative_phase);
  if v_phase_changed then
    new.phase_changed_at := now();
    if new.initiative_phase = 'Discover' then new.start_discovery := coalesce(new.start_discovery, current_date);
    elsif new.initiative_phase = 'Define' then new.start_definition := coalesce(new.start_definition, current_date);
    elsif new.initiative_phase = 'Build' then
      if new.ready_for_build_at is null or new.status in ('In progress', 'Done') then
        new.start_building := coalesce(new.start_building, current_date);
      end if;
    elsif new.initiative_phase = 'Test' then new.start_beta := coalesce(new.start_beta, current_date);
    elsif new.initiative_phase = 'Experiment' then new.start_experiment := coalesce(new.start_experiment, current_date);
    elsif new.initiative_phase = 'Roll-out' then new.start_rollout := coalesce(new.start_rollout, current_date);
    end if;
    if tg_op = 'UPDATE' and old.initiative_phase = 'Build' and new.start_building is null then
      new.start_building := current_date;
    end if;
    new.current_gate := public.phase_gate(new.initiative_phase);
    new.gate_status := case when new.current_gate is not null then 'Not started' end;
    new.next_gate_due := null;
  end if;
  if tg_op = 'UPDATE' and new.status = 'In progress' and old.status is distinct from 'In progress'
     and new.initiative_phase = 'Build' and new.start_building is null then
    new.start_building := current_date;
  end if;
  return new;
end $$;
