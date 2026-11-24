-- A decision's rationale is optional (Ashu, 2026-11-23, docs/decisions/2026-11-23-decide-three-buttons-optional-comment.md).
-- When one is written it is still kept exactly as written and the decision stays append-only; a blank one is stored as null.
-- The only changes to decide_gate: no "needs a rationale" check, and a blank rationale becomes null. Signature, rights, Claude refusal (PV004)
-- and everything else are as in 20261105160804_decision_gates.sql. decide_gates calls decide_gate, so it needs no change.
alter table public.gate_reviews drop constraint gate_reviews_rationale;

create or replace function public.decide_gate(p_review uuid, p_outcome text, p_rationale text, p_fast_lane boolean default false,
                                   p_target_phase text default null, p_conditions text[] default '{}', p_review_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.gate_reviews;
  it public.items;
  v_cur int;
  v_def text;
  v_target text;
  v_idx int;
  v_skipped text[] := '{}';
  v_fast boolean := coalesce(p_fast_lane, false);
  g text;
  c text;
begin
  select * into r from public.gate_reviews where id = p_review for update;
  if not found then raise exception 'Gate request not found' using errcode = 'PV005'; end if;
  if public.write_source() = 'MCP'
     or exists (select 1 from public.tenant_members m where m.tenant_id = r.tenant_id and m.user_id = auth.uid() and m.is_service_account) then
    raise exception 'Claude and service accounts cannot decide a gate; a person with approval rights does' using errcode = 'PV004';
  end if;
  if not public.can_decide_gate(r.tenant_id, r.gate) then
    raise exception 'You do not have approval rights for gate %', r.gate using errcode = '42501';
  end if;
  if r.decided_at is not null or r.withdrawn_at is not null or r.kind <> 'decision' then
    raise exception 'This request is already closed' using errcode = 'PV006';
  end if;
  if p_outcome not in ('go', 'go_with_conditions', 'hold', 'stop') then
    raise exception 'The outcome must be go, go_with_conditions, hold or stop' using errcode = 'PV005';
  end if;
  select * into it from public.items where id = r.item_id for update;
  v_cur := coalesce(public.phase_index(it.initiative_phase), 1);
  if v_cur > public.gate_from_index(r.gate) then
    raise exception 'This initiative is already past gate %', r.gate using errcode = 'PV006';
  end if;

  if p_outcome in ('go', 'go_with_conditions') then
    v_def := public.gate_to_phase(r.gate);
    v_target := coalesce(nullif(btrim(p_target_phase), ''), v_def);
    v_idx := public.phase_index(v_target);
    if v_idx is null or v_idx < public.phase_index(v_def) or v_idx > 6 then
      raise exception 'The target phase must be % or a later phase up to Roll-out', v_def using errcode = 'PV005';
    end if;
    -- skipping is allowed and recorded (fast lane); the approver's judgment, no check
    v_skipped := array(
      select t.p from unnest(array['Discover', 'Define', 'Build', 'Test', 'Experiment', 'Roll-out']) with ordinality t (p, ord)
       where t.ord > v_cur and t.ord < v_idx);
    v_fast := v_fast or cardinality(v_skipped) > 0;
    for g in select x from unnest(array['A', 'B', 'C']) x
              where x <> r.gate and public.gate_from_index(x) >= v_cur and public.gate_from_index(x) < v_idx loop
      insert into public.gate_reviews (tenant_id, item_id, gate, kind, ready, outcome, rationale, fast_lane, target_phase, decided_by, decided_at)
      values (r.tenant_id, r.item_id, g, 'skipped', false, 'go', 'Skipped (fast lane) at the decision of gate ' || r.gate, true, v_target, auth.uid(), now());
    end loop;

    -- the document this gate approves
    if r.gate in ('A', 'B') then
      perform set_config('pv.gate_approval', 'on', true);
      update public.item_documents d set status = 'approved'
       where d.tenant_id = r.tenant_id and d.item_id = r.item_id and d.status <> 'approved'
         and d.kind = case r.gate when 'A' then 'discovery' else 'prd' end;
      perform set_config('pv.gate_approval', '', true);
    end if;

    perform set_config('pv.phase_move', 'on', true);
    update public.items
       set initiative_phase = v_target,
           ready_for_build_by = case when r.gate = 'B' then auth.uid() else ready_for_build_by end,
           ready_for_build_at = case when r.gate = 'B' then now() else ready_for_build_at end
     where id = r.item_id;
    perform set_config('pv.phase_move', '', true);
  elsif p_outcome = 'hold' then
    update public.items set gate_status = 'Held', next_gate_due = p_review_date where id = r.item_id;
  else
    update public.items set gate_status = 'Stopped', initiative_status = 'Cancelled' where id = r.item_id;
  end if;

  update public.gate_reviews
     set outcome = p_outcome, rationale = nullif(btrim(p_rationale), ''), fast_lane = v_fast, target_phase = v_target, skipped_phases = v_skipped,
         review_date = p_review_date, decided_by = auth.uid(), decided_at = now()
   where id = r.id;

  if p_outcome = 'go_with_conditions' then
    foreach c in array coalesce(p_conditions, '{}') loop
      if char_length(btrim(c)) > 0 then
        insert into public.gate_conditions (tenant_id, review_id, item_id, text) values (r.tenant_id, r.id, r.item_id, btrim(c));
      end if;
    end loop;
  end if;
  return jsonb_build_object('review_id', r.id, 'item_id', r.item_id, 'gate', r.gate, 'outcome', p_outcome, 'phase', v_target,
                            'fast_lane', v_fast, 'skipped_phases', to_jsonb(v_skipped));
end $$;
