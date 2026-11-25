-- Issue #679 (Ashu, 2026-11-25), docs/decisions/2026-11-25-change-phase-any-phase.md. Forward-only; no data change.
-- Replaces the whole function public.move_phase (last defined in 20261118132442_sunset_phase_tech_debt; no other open branch changes it).
-- A forward move that passes a decision gate is now allowed for a person who can decide every gate it passes (Admin, Approver or on the
-- gate's list). It needs a comment and is recorded as one "Skipped (fast lane)" row per gate, like a fast-lane Go. Everyone else still
-- gets PV006 ("request it"). Claude and service accounts never move a phase here (PV004). Past Roll-out (Sunset) stays reachable only
-- from Roll-out or Completed.
drop function public.move_phase(uuid, text);

create function public.move_phase(p_item uuid, p_to text, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_from int;
  v_to int;
  g text;
  v_gates text[];
  v_skipped text[];
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

  v_gates := array(select x from unnest(array['A', 'B', 'C']) x
                    where v_to > v_from and public.gate_from_index(x) >= v_from and public.gate_from_index(x) < v_to order by x);
  if cardinality(v_gates) > 0 then
    if public.write_source() = 'MCP'
       or exists (select 1 from public.tenant_members m where m.tenant_id = it.tenant_id and m.user_id = auth.uid() and m.is_service_account) then
      raise exception 'Claude and service accounts cannot move an initiative past a gate; a person with approval rights does' using errcode = 'PV004';
    end if;
    foreach g in array v_gates loop
      if not public.can_decide_gate(it.tenant_id, g) then
        raise exception 'This move passes a decision gate; request it instead' using errcode = 'PV006';
      end if;
    end loop;
    if v_to > 6 then
      raise exception 'Sunset is chosen from Roll-out or Completed' using errcode = 'PV005';
    end if;
    if char_length(btrim(coalesce(p_comment, ''))) < 3 then
      raise exception 'Moving past a gate needs a comment' using errcode = 'PV005';
    end if;
    v_skipped := array(
      select t.p from unnest(array['Discover', 'Define', 'Build', 'Test', 'Experiment', 'Roll-out']) with ordinality t (p, ord)
       where t.ord > v_from and t.ord < v_to);
    foreach g in array v_gates loop
      insert into public.gate_reviews (tenant_id, item_id, gate, kind, ready, outcome, rationale, fast_lane, target_phase, skipped_phases, decided_by, decided_at)
      values (it.tenant_id, it.id, g, 'skipped', false, 'go', 'Skipped (fast lane) by a phase change: ' || btrim(p_comment), true, p_to, v_skipped, auth.uid(), now());
    end loop;
  end if;

  update public.gate_reviews set withdrawn_at = now(), withdrawn_by = auth.uid()
   where item_id = p_item and kind = 'decision' and decided_at is null and withdrawn_at is null;
  perform set_config('pv.phase_move', 'on', true);
  update public.items set initiative_phase = p_to where id = p_item;
  perform set_config('pv.phase_move', '', true);
end $$;

revoke all on function public.move_phase(uuid, text, text) from public, anon, authenticated;
grant execute on function public.move_phase(uuid, text, text) to authenticated;
