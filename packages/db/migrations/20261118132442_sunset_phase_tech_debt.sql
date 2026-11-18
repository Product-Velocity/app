-- Ashu (2026-11-18, Refinery89 roadmap review): Sunset is a phase again (after Completed) and Change Type gets a fourth value, Tech debt.
-- docs/decisions/2026-11-18-sunset-phase-and-tech-debt.md. Forward-only; no data change. Replaces whole functions: public.phase_index,
-- public.items_system_fields (last defined in 20261105160804_decision_gates) and public.move_phase (same file). No other open branch changes them.

-- 1. Values
alter table public.items drop constraint if exists items_initiative_phase_check;
alter table public.items add constraint items_initiative_phase_check
  check (initiative_phase in ('Discover', 'Define', 'Build', 'Test', 'Experiment', 'Roll-out', 'Completed', 'Sunset'));
alter table public.items drop constraint if exists items_change_type_check;
alter table public.items add constraint items_change_type_check
  check (change_type in ('New feature', 'Improvement to existing feature', 'Bug', 'Tech debt'));

-- 2. Sunset comes after Completed and passes no gate
create or replace function public.phase_index(p text) returns int
language sql immutable set search_path = '' as $$
  select case p when 'Discover' then 1 when 'Define' then 2 when 'Build' then 3 when 'Test' then 4
                when 'Experiment' then 5 when 'Roll-out' then 6 when 'Completed' then 7 when 'Sunset' then 8 end
$$;

-- 3. Initiative Status Completed puts the phase on Completed, except on a Sunset item (the phase after Completed keeps its place)
create or replace function public.items_system_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text;
  v_phase_changed boolean;
begin
  if tg_op = 'INSERT' or coalesce(current_setting('pv.rank_internal', true), '') <> 'on' then
    new.last_edited_at := now();
    new.last_edited_by := auth.uid();
  end if;

  if tg_op = 'INSERT' and new.initiative_status = 'Completed' then
    if new.initiative_phase is distinct from 'Sunset' then new.initiative_phase := 'Completed'; end if;
  elsif tg_op = 'UPDATE' and new.initiative_status is distinct from old.initiative_status then
    if new.initiative_status = 'Completed' then
      if new.initiative_phase is distinct from 'Sunset' then new.initiative_phase := 'Completed'; end if;
    elsif old.initiative_status = 'Completed' and new.initiative_phase = 'Completed' then
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

-- 4. move_phase: Sunset can be chosen from Roll-out or Completed (no gate lies between); an earlier phase still needs its gate (PV006)
create or replace function public.move_phase(p_item uuid, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_from int;
  v_to int;
begin
  select i.id, i.tenant_id, i.initiative_phase, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(it.tenant_id);
  if p_to = 'Completed' then
    raise exception 'Set Initiative Status to Completed; the phase follows' using errcode = 'PV005';
  end if;
  v_to := public.phase_index(p_to);
  if v_to is null then raise exception 'Unknown phase' using errcode = 'PV005'; end if;
  v_from := coalesce(public.phase_index(it.initiative_phase), 1);
  if it.initiative_phase = 'Completed' and p_to <> 'Sunset' then
    raise exception 'A completed initiative is reopened by setting Initiative Status back to Active' using errcode = 'PV005';
  end if;
  if v_to = v_from and it.initiative_phase is not null then
    raise exception 'The initiative is already in %', p_to using errcode = 'PV005';
  end if;
  if v_to > v_from and exists (select 1 from unnest(array['A', 'B', 'C']) g
                               where public.gate_from_index(g) >= v_from and public.gate_from_index(g) < v_to) then
    raise exception 'This move passes a decision gate; request it instead' using errcode = 'PV006';
  end if;
  update public.gate_reviews set withdrawn_at = now(), withdrawn_by = auth.uid()
   where item_id = p_item and kind = 'decision' and decided_at is null and withdrawn_at is null;
  perform set_config('pv.phase_move', 'on', true);
  update public.items set initiative_phase = p_to where id = p_item;
  perform set_config('pv.phase_move', '', true);
end $$;
