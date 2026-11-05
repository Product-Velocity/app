-- 20261105160804_decision_gates: <what this changes and why; the request or issue number>
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- New tables: RLS with the fast policy pattern, an index starting with tenant_id, and a probe in packages/db/tests/rls.test.ts.
-- If you replace a whole function (create or replace), say which, and check no open branch changes it too (docs/23-PARALLEL-WORK.md).

-- Decision gates A, B and C (issue #323; docs/28-DECISION-GATES.md; docs/decisions/2026-11-05-lifecycle-and-gates.md).
-- New: items.current_gate, gate_status, next_gate_due, ready_for_build_by/at; tables gate_reviews, gate_conditions, tenant_gate_approvers;
-- functions request_gate(s), decide_gate(s), move_phase, gate_condition_done, set_gate_approvers, can_decide_gate, my_decidable_gates.
-- Rules in the database, not only the app: Initiative Phase moves only through these functions (guard PV006); Claude, service accounts and
-- non-members can neither request nor decide (PV004); a document is approved only by the gate that owns it; a decision and its rationale
-- are written once (append-only); Completed follows Initiative Status.
-- Replaces whole functions: public.items_system_fields (also replaced by 20261105160035_phase_values_test_completed, this branch only) and
-- public.item_documents_guard (last defined in 20261030091015_document_ai_tool_model). No other open branch changes them.

-- ---------------------------------------------------------------------------
-- 1. Phase and gate helpers
-- ---------------------------------------------------------------------------
create function public.phase_index(p text) returns int
language sql immutable set search_path = '' as $$
  select case p when 'Discover' then 1 when 'Define' then 2 when 'Build' then 3 when 'Test' then 4
                when 'Experiment' then 5 when 'Roll-out' then 6 when 'Completed' then 7 end
$$;
-- the phase a gate is passed from (the item must be at or before it) and the phase it opens
create function public.gate_from_index(g text) returns int
language sql immutable set search_path = '' as $$
  select case g when 'A' then 1 when 'B' then 2 when 'C' then 5 end
$$;
create function public.gate_to_phase(g text) returns text
language sql immutable set search_path = '' as $$
  select case g when 'A' then 'Define' when 'B' then 'Build' when 'C' then 'Roll-out' end
$$;
create function public.phase_gate(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'Discover' then 'A' when 'Define' then 'B' when 'Experiment' then 'C' end
$$;

-- ---------------------------------------------------------------------------
-- 2. Items: gate columns (system-set, never granted to API roles)
-- ---------------------------------------------------------------------------
alter table public.items
  add column current_gate text check (current_gate in ('A', 'B', 'C')),
  add column gate_status text check (gate_status in
    ('Not started', 'In review', 'Waiting for Approver', 'Passed with conditions', 'Passed', 'Held', 'Stopped')),
  add column next_gate_due date,
  add column ready_for_build_by uuid references auth.users (id) on delete set null,
  add column ready_for_build_at timestamptz;

alter table public.items disable trigger items_d_system;
update public.items
   set current_gate = public.phase_gate(initiative_phase),
       gate_status = case when public.phase_gate(initiative_phase) is not null then 'Not started' end
 where initiative_phase is not null;
alter table public.items enable trigger items_d_system;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create table public.gate_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  gate text not null check (gate in ('A', 'B', 'C')),
  kind text not null default 'decision' check (kind in ('decision', 'skipped')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  preferred_approvers uuid[] not null default '{}',
  ready boolean not null default false,
  criteria jsonb not null default '[]'::jsonb,
  outcome text check (outcome in ('go', 'go_with_conditions', 'hold', 'stop')),
  rationale text check (char_length(rationale) <= 4000),
  fast_lane boolean not null default false,
  target_phase text check (target_phase in ('Define', 'Build', 'Test', 'Experiment', 'Roll-out')),
  skipped_phases text[] not null default '{}',
  review_date date,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  withdrawn_by uuid references auth.users (id) on delete set null,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  constraint gate_reviews_decided check ((decided_at is null) = (outcome is null)),
  constraint gate_reviews_rationale check (outcome is null or kind = 'skipped' or char_length(btrim(coalesce(rationale, ''))) >= 3),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index gate_reviews_item_idx on public.gate_reviews (tenant_id, item_id, requested_at desc);
create index gate_reviews_open_idx on public.gate_reviews (tenant_id, requested_at)
  where decided_at is null and withdrawn_at is null and kind = 'decision';
create unique index gate_reviews_one_open_per_item on public.gate_reviews (item_id)
  where decided_at is null and withdrawn_at is null and kind = 'decision';

create table public.gate_conditions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  review_id uuid not null references public.gate_reviews (id) on delete cascade,
  item_id uuid not null,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index gate_conditions_item_idx on public.gate_conditions (tenant_id, item_id);
create index gate_conditions_review_idx on public.gate_conditions (tenant_id, review_id);

create table public.tenant_gate_approvers (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  gate text not null check (gate in ('A', 'B', 'C')),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (tenant_id, gate, user_id),
  foreign key (tenant_id, user_id) references public.tenant_members (tenant_id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 4. Who may do what
-- ---------------------------------------------------------------------------
-- Approval rights: an active member who is not a service account, never a Claude token, and who is an Admin (default), holds the Approver
-- permission, or is on that gate's list. Staff are not tenant members, so they never qualify.
create function public.can_decide_gate(p_tenant uuid, p_gate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.write_source() <> 'MCP'
     and exists (
       select 1 from public.tenant_members m
        where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and not m.is_service_account
          and (m.role = 'admin' or m.is_approver
               or exists (select 1 from public.tenant_gate_approvers g
                           where g.tenant_id = p_tenant and g.gate = p_gate and g.user_id = m.user_id)))
$$;

create function public.my_decidable_gates(p_tenant uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(g order by g), '{}') from unnest(array['A', 'B', 'C']) g where public.can_decide_gate(p_tenant, g)
$$;

create function public.gate_assert_editor(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.write_source() = 'MCP' then
    raise exception 'Claude cannot request or move a gate; a person does' using errcode = 'PV004';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.is_service_account) then
    raise exception 'Service accounts cannot request or move a gate' using errcode = 'PV004';
  end if;
  if not exists (select 1 from public.tenant_members m
                  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and m.role in ('creator', 'admin')) then
    raise exception 'Only a Creator or an Admin can do this' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Guards: gate rows are written once; Initiative Phase moves only through the functions below
-- ---------------------------------------------------------------------------
create function public.gate_reviews_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- only the removal of the whole initiative (a purge) may take its decisions with it
    if exists (select 1 from public.items i where i.id = old.item_id) then
      raise exception 'A gate decision cannot be deleted' using errcode = 'PV006';
    end if;
    return old;
  end if;
  if old.decided_at is not null or old.withdrawn_at is not null then
    raise exception 'A gate decision cannot be changed' using errcode = 'PV006';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.item_id is distinct from old.item_id or new.gate is distinct from old.gate
     or new.kind is distinct from old.kind or new.requested_by is distinct from old.requested_by or new.requested_at is distinct from old.requested_at then
    raise exception 'A gate request cannot be moved or re-attributed' using errcode = 'PV006';
  end if;
  return new;
end $$;

create function public.gate_conditions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.items i where i.id = old.item_id) then
      raise exception 'A gate condition cannot be deleted' using errcode = 'PV006';
    end if;
    return old;
  end if;
  if new.text is distinct from old.text or new.review_id is distinct from old.review_id or new.item_id is distinct from old.item_id
     or new.tenant_id is distinct from old.tenant_id or old.done_at is not null then
    raise exception 'A gate condition can only be marked done, once' using errcode = 'PV006';
  end if;
  return new;
end $$;

create trigger gate_reviews_a_meta before insert or update on public.gate_reviews
  for each row execute function public.set_write_meta();
create trigger gate_reviews_b_guard before update or delete on public.gate_reviews
  for each row execute function public.gate_reviews_guard();
create trigger gate_reviews_audit after insert or update or delete on public.gate_reviews
  for each row execute function public.audit_row();
create trigger gate_conditions_a_meta before insert or update on public.gate_conditions
  for each row execute function public.set_write_meta();
create trigger gate_conditions_b_guard before update or delete on public.gate_conditions
  for each row execute function public.gate_conditions_guard();
create trigger gate_conditions_audit after insert or update or delete on public.gate_conditions
  for each row execute function public.audit_row();
create trigger tenant_gate_approvers_audit after insert or delete on public.tenant_gate_approvers
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.gate_reviews
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.gate_conditions
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.tenant_gate_approvers
  for each row execute function platform.readonly_guard();

-- A person types a phase nowhere any more: it moves through request/decide or move_phase. System writes (no signed-in user) are not blocked.
create function public.items_phase_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.initiative_phase is distinct from old.initiative_phase
     and auth.uid() is not null and coalesce(current_setting('pv.phase_move', true), '') <> 'on' then
    raise exception 'Initiative Phase moves through a decision gate or Move to next phase, not by editing it' using errcode = 'PV006';
  end if;
  return new;
end $$;
create trigger items_c_phase_guard before update on public.items
  for each row execute function public.items_phase_guard();

-- ---------------------------------------------------------------------------
-- 6. items_system_fields: gate columns follow the phase; Completed follows Initiative Status; Build starts when the tracker says so
-- ---------------------------------------------------------------------------
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

  -- Initiative Status leads: Completed puts the phase on Completed; leaving Completed restores the phase it had before (from the audit log)
  if tg_op = 'INSERT' and new.initiative_status = 'Completed' then
    new.initiative_phase := 'Completed';
  elsif tg_op = 'UPDATE' and new.initiative_status is distinct from old.initiative_status then
    if new.initiative_status = 'Completed' then
      new.initiative_phase := 'Completed';
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
      -- Ready for build (Gate B passed) is a waiting state: Build time starts when the tracker reports work started, not at the gate
      if new.ready_for_build_at is null or new.status in ('In progress', 'Done') then
        new.start_building := coalesce(new.start_building, current_date);
      end if;
    elsif new.initiative_phase = 'Test' then new.start_beta := coalesce(new.start_beta, current_date);
    elsif new.initiative_phase = 'Experiment' then new.start_experiment := coalesce(new.start_experiment, current_date);
    elsif new.initiative_phase = 'Roll-out' then new.start_rollout := coalesce(new.start_rollout, current_date);
    end if;
    -- leaving Build for good without the tracker ever starting it: the build started when it left
    if tg_op = 'UPDATE' and old.initiative_phase = 'Build' and new.start_building is null then
      new.start_building := current_date;
    end if;
    -- the gate this phase ends with, not started
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

-- ---------------------------------------------------------------------------
-- 7. Documents are approved by the gate that owns them (A: discovery, B: PRD), nowhere else
-- ---------------------------------------------------------------------------
create or replace function public.item_documents_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude boolean := public.write_source() = 'MCP';
  v_content boolean;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := case when new.status = 'approved' then 'draft' else new.status end;
    new.approved_by := null;
    new.approved_at := null;
    if v_claude then
      new.ai_draft := true;
      new.ai_tool := coalesce(public.current_assistant(), 'other');
      new.ai_model := nullif(btrim(new.ai_model), '');
    else
      new.ai_tool := null;
      new.ai_model := null;
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id or new.item_id is distinct from old.item_id then
    raise exception 'A document cannot move to another initiative';
  end if;

  if v_claude then
    if new.ai_draft is distinct from old.ai_draft then
      raise exception 'Claude cannot accept or reject an AI draft; a person does' using errcode = 'PV004';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      raise exception 'Claude cannot approve a document; an Approver does' using errcode = 'PV004';
    end if;
  end if;

  v_content := new.title is distinct from old.title or new.body is distinct from old.body;
  if v_content then
    new.version := old.version + 1;
    -- a changed document is no longer the one that was approved
    if old.status = 'approved' and new.status = 'approved' then
      new.status := 'in_review';
    end if;
  else
    new.version := old.version;
  end if;

  if v_claude and v_content then
    new.ai_tool := coalesce(public.current_assistant(), 'other');
    new.ai_model := nullif(btrim(new.ai_model), '');
  else
    new.ai_tool := old.ai_tool;
    new.ai_model := old.ai_model;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    -- the only way in is decide_gate (it checks approval rights first and sets this for its own statement)
    if coalesce(current_setting('pv.gate_approval', true), '') <> 'on' then
      raise exception 'A document is approved by its decision gate (A for a discovery, B for a PRD), nowhere else' using errcode = 'PV004';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.ai_draft := false; -- a person approved it
  elsif new.status is distinct from 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Functions
-- ---------------------------------------------------------------------------
create function public.request_gate(p_item uuid, p_gate text, p_ready boolean default false, p_criteria jsonb default '[]'::jsonb,
                                    p_preferred uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_id uuid;
begin
  if p_gate not in ('A', 'B', 'C') then raise exception 'The gate must be A, B or C' using errcode = 'PV005'; end if;
  select i.id, i.tenant_id, i.initiative_phase, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(it.tenant_id);
  if coalesce(public.phase_index(it.initiative_phase), 1) > public.gate_from_index(p_gate) then
    raise exception 'This initiative is already past gate %', p_gate using errcode = 'PV005';
  end if;
  if jsonb_typeof(coalesce(p_criteria, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'The checklist must be a list' using errcode = 'PV005';
  end if;
  begin
    insert into public.gate_reviews (tenant_id, item_id, gate, requested_by, ready, criteria, preferred_approvers)
    values (it.tenant_id, p_item, p_gate, auth.uid(), coalesce(p_ready, false), coalesce(p_criteria, '[]'::jsonb), coalesce(p_preferred, '{}'))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A gate request is already open for this initiative' using errcode = 'PV006';
  end;
  update public.items set current_gate = p_gate, gate_status = case when coalesce(p_ready, false) then 'Waiting for Approver' else 'In review' end
   where id = p_item;
  return v_id;
end $$;

create function public.decide_gate(p_review uuid, p_outcome text, p_rationale text, p_fast_lane boolean default false,
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
  if char_length(btrim(coalesce(p_rationale, ''))) < 3 then
    raise exception 'A decision needs a rationale' using errcode = 'PV005';
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
     set outcome = p_outcome, rationale = btrim(p_rationale), fast_lane = v_fast, target_phase = v_target, skipped_phases = v_skipped,
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

create function public.move_phase(p_item uuid, p_to text) returns void
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
  if it.initiative_phase = 'Completed' then
    raise exception 'A completed initiative is reopened by setting Initiative Status back to Active' using errcode = 'PV005';
  end if;
  if v_to = v_from and it.initiative_phase is not null then
    raise exception 'The initiative is already in %', p_to using errcode = 'PV005';
  end if;
  if v_to > v_from and exists (select 1 from unnest(array['A', 'B', 'C']) g
                               where public.gate_from_index(g) >= v_from and public.gate_from_index(g) < v_to) then
    raise exception 'This move passes a decision gate; request it instead' using errcode = 'PV006';
  end if;
  -- an open request belongs to the phase the item is leaving
  update public.gate_reviews set withdrawn_at = now(), withdrawn_by = auth.uid()
   where item_id = p_item and kind = 'decision' and decided_at is null and withdrawn_at is null;
  perform set_config('pv.phase_move', 'on', true);
  update public.items set initiative_phase = p_to where id = p_item;
  perform set_config('pv.phase_move', '', true);
end $$;

create function public.gate_condition_done(p_condition uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from public.gate_conditions where id = p_condition;
  if not found then raise exception 'Condition not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(c.tenant_id);
  update public.gate_conditions set done_at = now(), done_by = auth.uid() where id = p_condition and done_at is null;
end $$;

create function public.set_gate_approvers(p_tenant uuid, p_gate text, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_gate not in ('A', 'B', 'C') then raise exception 'The gate must be A, B or C' using errcode = 'PV005'; end if;
  if public.write_source() = 'MCP'
     or not exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.user_id = auth.uid()
                      and m.role = 'admin' and m.status = 'active' and not m.is_service_account) then
    raise exception 'Only an Admin can choose who decides a gate' using errcode = '42501';
  end if;
  delete from public.tenant_gate_approvers where tenant_id = p_tenant and gate = p_gate;
  insert into public.tenant_gate_approvers (tenant_id, gate, user_id, created_by)
  select p_tenant, p_gate, m.user_id, auth.uid() from public.tenant_members m
   where m.tenant_id = p_tenant and m.user_id = any (coalesce(p_users, '{}')) and m.status = 'active' and not m.is_service_account;
end $$;

-- Bulk: one result per item, one failing never stops the others
create function public.request_gates(p_gate text, p_requests jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q jsonb;
  out jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests) > 100 then
    raise exception 'Send a list of at most 100 requests' using errcode = 'PV005';
  end if;
  for q in select * from jsonb_array_elements(p_requests) loop
    begin
      v_id := public.request_gate((q ->> 'item')::uuid, p_gate, coalesce((q ->> 'ready')::boolean, false), coalesce(q -> 'criteria', '[]'::jsonb));
      out := out || jsonb_build_object('item', q ->> 'item', 'ok', true, 'review_id', v_id);
    exception when others then
      out := out || jsonb_build_object('item', q ->> 'item', 'ok', false, 'error', sqlerrm, 'code', sqlstate);
    end;
  end loop;
  return out;
end $$;

create function public.decide_gates(p_reviews uuid[], p_outcome text, p_rationale text, p_fast_lane boolean default false,
                                    p_target_phase text default null, p_conditions text[] default '{}', p_review_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x uuid;
  out jsonb := '[]'::jsonb;
begin
  if cardinality(coalesce(p_reviews, '{}')) > 100 then raise exception 'Decide at most 100 at a time' using errcode = 'PV005'; end if;
  foreach x in array coalesce(p_reviews, '{}') loop
    begin
      out := out || (public.decide_gate(x, p_outcome, p_rationale, p_fast_lane, p_target_phase, p_conditions, p_review_date) || jsonb_build_object('ok', true));
    exception when others then
      out := out || jsonb_build_object('review_id', x, 'ok', false, 'error', sqlerrm, 'code', sqlstate);
    end;
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- 9. items_computed: Ready for build is real now; Define time ends at the Gate B decision
-- ---------------------------------------------------------------------------
drop view public.items_computed;
create view public.items_computed with (security_invoker = true) as
select
  s.id, s.tenant_id,
  s.value_weighted,
  round(s.value_weighted / nullif(s.estimate_high_weeks, 0), 2) as value_weighted_per_build_week,
  null::numeric as adoption_pct,
  null::numeric as kr_realized_pct,
  s.time_discovery_days,
  s.time_definition_days,
  s.time_building_days,
  s.time_beta_days,
  s.time_experiment_days,
  s.time_rollout_days,
  s.g2m_date_actual - s.start_date as time_to_market_days,
  round(s.time_building_days / 7.0, 1) as actual_build_weeks,
  round(s.time_building_days / 7.0 / nullif(s.estimate_high_weeks, 0) * 100) as build_vs_estimate_high_pct,
  null::int as blocked_days,
  null::int as g2m_slip_days,
  null::int as crowd_rank,
  null::numeric as crowd_score,
  null::numeric as crowd_consensus,
  null::int as crowd_votes,
  s.next_review_date < current_date as review_overdue,
  current_date - s.phase_changed_at::date as days_in_phase,
  current_date - s.created_at::date as item_age_days,
  s.project_rank,
  null::jsonb as fit_by_team,
  case
    when s.current_gate = 'B' and s.gate_status in ('In review', 'Waiting for Approver') then 'Requested'
    when s.ready_for_build_at is not null and s.initiative_phase = 'Build' and s.start_building is null then 'Ready'
    when s.initiative_phase is null or s.initiative_phase in ('Discover', 'Define') then 'Not ready'
  end as ready_for_build,
  null::text as alignment_status,
  null::numeric as value_variance_pct,
  null::int as time_to_first_use_days,
  s.github_issue_url is not null as locked_by_source
from (
  select i.*,
    round(i.value_12m * case i.confidence when 'High' then 0.9 when 'Medium' then 0.6 when 'Low' then 0.3 end, 2) as value_weighted,
    row_number() over (partition by i.tenant_id, i.cycle_id, i.home_project_id order by i.stack_rank)::int as project_rank,
    coalesce(i.start_definition, i.ready_for_build_at::date, i.start_building, i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_discovery as time_discovery_days,
    coalesce(i.ready_for_build_at::date, i.start_building, i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_definition as time_definition_days,
    coalesce(i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_building as time_building_days,
    coalesce(i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_beta as time_beta_days,
    coalesce(i.start_rollout, i.g2m_date_actual) - i.start_experiment as time_experiment_days,
    i.g2m_date_actual - i.start_rollout as time_rollout_days
  from public.items i
) s;
revoke all on public.items_computed from public, anon, authenticated;
grant select on public.items_computed to authenticated;

-- ---------------------------------------------------------------------------
-- 10. RLS and grants: everyone in the workspace reads; every write goes through the functions above
-- ---------------------------------------------------------------------------
alter table public.gate_reviews enable row level security;
alter table public.gate_conditions enable row level security;
alter table public.tenant_gate_approvers enable row level security;
create policy gate_reviews_select on public.gate_reviews for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy gate_conditions_select on public.gate_conditions for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy tenant_gate_approvers_select on public.tenant_gate_approvers for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.gate_reviews, public.gate_conditions, public.tenant_gate_approvers from public, anon, authenticated;
grant select on public.gate_reviews, public.gate_conditions, public.tenant_gate_approvers to authenticated;

revoke all on function
  public.phase_index(text), public.gate_from_index(text), public.gate_to_phase(text), public.phase_gate(text),
  public.can_decide_gate(uuid, text), public.my_decidable_gates(uuid), public.gate_assert_editor(uuid),
  public.gate_reviews_guard(), public.gate_conditions_guard(), public.items_phase_guard(), public.items_system_fields(),
  public.item_documents_guard(),
  public.request_gate(uuid, text, boolean, jsonb, uuid[]), public.decide_gate(uuid, text, text, boolean, text, text[], date),
  public.move_phase(uuid, text), public.gate_condition_done(uuid), public.set_gate_approvers(uuid, text, uuid[]),
  public.request_gates(text, jsonb), public.decide_gates(uuid[], text, text, boolean, text, text[], date)
  from public, anon, authenticated;
grant execute on function
  public.can_decide_gate(uuid, text), public.my_decidable_gates(uuid),
  public.request_gate(uuid, text, boolean, jsonb, uuid[]), public.decide_gate(uuid, text, text, boolean, text, text[], date),
  public.move_phase(uuid, text), public.gate_condition_done(uuid), public.set_gate_approvers(uuid, text, uuid[]),
  public.request_gates(text, jsonb), public.decide_gates(uuid[], text, text, boolean, text, text[], date)
  to authenticated;
