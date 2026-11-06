-- 20261105235416_gate_notifications: <what this changes and why; the request or issue number>
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- New tables: RLS with the fast policy pattern, an index starting with tenant_id, and a probe in packages/db/tests/rls.test.ts.
-- If you replace a whole function (create or replace), say which, and check no open branch changes it too (docs/23-PARALLEL-WORK.md).

-- Gate notifications (issue #341; docs/28-DECISION-GATES.md; docs/decisions/2026-11-05-gate-notifications.md).
-- An in-app inbox. Rows are written only by the triggers below (so every route notifies the same way), read only by their owner, and marked read only
-- through mark_notifications_read. They hold the initiative code and name and the gate, never a rationale, a document or a commercial field.
-- Notifications are derived data: the gate request or decision they come from is audited, so they are not audited a second time.
-- Replaces the whole function public.request_gates (created in 20261105160804_decision_gates, this family only) to pass the people the requester asked.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('gate_requested', 'gate_decided', 'gate_withdrawn')),
  item_id uuid,
  review_id uuid references public.gate_reviews (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references public.tenant_members (tenant_id, user_id) on delete cascade
);
create index notifications_user_idx on public.notifications (tenant_id, user_id, created_at desc);
create index notifications_unread_idx on public.notifications (tenant_id, user_id) where read_at is null;
create index notifications_review_idx on public.notifications (tenant_id, review_id) where review_id is not null;

-- Everyone who may decide a gate: an active member who is not a service account and is an Admin, holds the Approver permission, or is on the gate's list.
create function public.gate_deciders(p_tenant uuid, p_gate text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.tenant_members m
   where m.tenant_id = p_tenant and m.status = 'active' and not m.is_service_account
     and (m.role = 'admin' or m.is_approver
          or exists (select 1 from public.tenant_gate_approvers g where g.tenant_id = p_tenant and g.gate = p_gate and g.user_id = m.user_id))
$$;

create function public.gate_reviews_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_name text;
  v_ids uuid[];
begin
  if new.kind <> 'decision' then return null; end if;
  select i.item_code, i.initiative_name into v_code, v_name from public.items i where i.id = new.item_id;
  if tg_op = 'INSERT' then
    -- the people the requester named, when they can decide; otherwise everyone who can; never the requester
    select coalesce(
             nullif(array(select d from public.gate_deciders(new.tenant_id, new.gate) d where d = any (new.preferred_approvers) and d is distinct from new.requested_by), '{}'),
             array(select d from public.gate_deciders(new.tenant_id, new.gate) d where d is distinct from new.requested_by)) into v_ids;
    insert into public.notifications (tenant_id, user_id, kind, item_id, review_id, payload)
    select new.tenant_id, u, 'gate_requested', new.item_id, new.id,
           jsonb_build_object('gate', new.gate, 'item_code', v_code, 'item_name', v_name, 'ready', new.ready)
      from unnest(v_ids) u;
  else
    if old.decided_at is null and new.decided_at is not null then
      -- the request is answered: it is no longer news for the other approvers
      update public.notifications set read_at = now() where review_id = new.id and kind = 'gate_requested' and read_at is null;
      if new.requested_by is not null and new.requested_by is distinct from new.decided_by then
        insert into public.notifications (tenant_id, user_id, kind, item_id, review_id, payload)
        values (new.tenant_id, new.requested_by, 'gate_decided', new.item_id, new.id,
                jsonb_build_object('gate', new.gate, 'outcome', new.outcome, 'fast_lane', new.fast_lane, 'item_code', v_code, 'item_name', v_name));
      end if;
    elsif old.withdrawn_at is null and new.withdrawn_at is not null then
      update public.notifications set read_at = now() where review_id = new.id and kind = 'gate_requested' and read_at is null;
      if new.requested_by is not null and new.requested_by is distinct from new.withdrawn_by then
        insert into public.notifications (tenant_id, user_id, kind, item_id, review_id, payload)
        values (new.tenant_id, new.requested_by, 'gate_withdrawn', new.item_id, new.id,
                jsonb_build_object('gate', new.gate, 'item_code', v_code, 'item_name', v_name));
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger gate_reviews_notify_insert after insert on public.gate_reviews
  for each row execute function public.gate_reviews_notify();
create trigger gate_reviews_notify_update after update on public.gate_reviews
  for each row execute function public.gate_reviews_notify();

-- Only the owner marks their own notifications read (all of them when no list is given); never Claude or a service account.
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null or public.write_source() = 'MCP' then
    raise exception 'Only a person marks their notifications read' using errcode = 'PV004';
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.request_gates(p_gate text, p_requests jsonb) returns jsonb
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
      v_id := public.request_gate((q ->> 'item')::uuid, p_gate, coalesce((q ->> 'ready')::boolean, false), coalesce(q -> 'criteria', '[]'::jsonb),
        coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(case when jsonb_typeof(q -> 'preferred') = 'array' then q -> 'preferred' else '[]'::jsonb end) x), '{}'));
      out := out || jsonb_build_object('item', q ->> 'item', 'ok', true, 'review_id', v_id);
    exception when others then
      out := out || jsonb_build_object('item', q ->> 'item', 'ok', false, 'error', sqlerrm, 'code', sqlstate);
    end;
  end loop;
  return out;
end $$;

create trigger a_platform_readonly_guard before insert or update or delete on public.notifications
  for each row execute function platform.readonly_guard();

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())) and user_id = (select auth.uid()));
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
revoke all on function public.gate_deciders(uuid, text), public.gate_reviews_notify(), public.mark_notifications_read(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
revoke all on function public.request_gates(text, jsonb) from public, anon, authenticated;
grant execute on function public.request_gates(text, jsonb) to authenticated;
