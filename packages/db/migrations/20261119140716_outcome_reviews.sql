-- 20261119140716_outcome_reviews: the 30, 60 and 90 day outcome reviews after Roll-out, and the request for them (Ashu, chat 2026-11-19; docs/decisions/2026-11-19-outcome-reviews.md).
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- New table public.outcome_reviews: one row per initiative and checkpoint (30, 60 or 90 days after Start Roll-Out). A row is created when someone asks for the
--   metrics ("requested": requested_at, requested_by, requested_to) and filled when they are recorded (recorded_at, recorded_by, the realised value of the
--   Primary KR, the adoption %, a note). Members read it (RLS on the fast pattern); nobody writes it directly: only the two functions below do.
-- request_outcome_review(item, at_days): an editor (Creator or Admin), never Claude or a service account (PV004), the same rule as a gate request. Needs a Start Roll-Out
--   date. Asks the Product Manager (owner_user_id), else the person who created the initiative, with an in-app notification. A second request for the same checkpoint is PV006.
-- record_outcome_review(item, at_days, value, adoption, note): an editor; creates or fills the row; adoption 0 to 100; at least one value.
-- notifications.kind also allows 'outcome_requested' (the constraint is replaced; the table is not otherwise changed). Outcomes are never synced to a tracker (rule 2):
--   nothing here is in any GitHub or Jira payload.
-- No SQL function is replaced; one check constraint is dropped and re-added with the new kind.

create table public.outcome_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  at_days smallint not null check (at_days in (30, 60, 90)),
  due_on date not null,
  requested_at timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  requested_to uuid references auth.users (id) on delete set null,
  realised_kr_value numeric,
  adoption_pct numeric check (adoption_pct is null or (adoption_pct >= 0 and adoption_pct <= 100)),
  notes text check (notes is null or char_length(notes) <= 2000),
  recorded_at timestamptz,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, item_id, at_days),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index outcome_reviews_tenant_item on public.outcome_reviews (tenant_id, item_id);
create trigger outcome_reviews_meta before insert or update on public.outcome_reviews
  for each row execute function public.set_write_meta();
create trigger outcome_reviews_audit after insert or update on public.outcome_reviews
  for each row execute function public.audit_row();
-- platform staff read, never write, customer data (rule 10)
create trigger a_platform_readonly_guard before insert or update or delete on public.outcome_reviews
  for each row execute function platform.readonly_guard();
alter table public.outcome_reviews enable row level security;
create policy outcome_reviews_select on public.outcome_reviews for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.outcome_reviews from public, anon, authenticated;
grant select on public.outcome_reviews to authenticated;
grant all on public.outcome_reviews to service_role;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('gate_requested', 'gate_decided', 'gate_withdrawn', 'outcome_requested'));

-- A request for the metrics tells the person asked, once (not the person who asked). The text holds the initiative code and name and the checkpoint only.
create function public.outcome_reviews_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_name text;
begin
  if new.requested_to is null or new.requested_to is not distinct from new.requested_by then return null; end if;
  select i.item_code, i.initiative_name into v_code, v_name from public.items i where i.id = new.item_id;
  insert into public.notifications (tenant_id, user_id, kind, item_id, payload)
  values (new.tenant_id, new.requested_to, 'outcome_requested', new.item_id,
          jsonb_build_object('at_days', new.at_days, 'item_code', v_code, 'item_name', v_name));
  return null;
end $$;
create trigger outcome_reviews_notify_insert after insert on public.outcome_reviews
  for each row when (new.requested_at is not null) execute function public.outcome_reviews_notify();

create function public.request_outcome_review(p_item uuid, p_at_days integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_to uuid;
  v_id uuid;
begin
  if p_at_days not in (30, 60, 90) then raise exception 'The review is at 30, 60 or 90 days' using errcode = 'PV005'; end if;
  select i.id, i.tenant_id, i.start_rollout, i.owner_user_id, i.created_by, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(it.tenant_id);
  if it.start_rollout is null then raise exception 'This initiative has no Start Roll-Out date yet, so the review has no due date' using errcode = 'PV005'; end if;
  -- the Product Manager, else the creator, when they are still an active member of this workspace
  select m.user_id into v_to from public.tenant_members m
   where m.tenant_id = it.tenant_id and m.status = 'active' and not m.is_service_account and m.user_id in (it.owner_user_id, it.created_by)
   order by (m.user_id = it.owner_user_id) desc nulls last limit 1;
  begin
    insert into public.outcome_reviews (tenant_id, item_id, at_days, due_on, requested_at, requested_by, requested_to)
    values (it.tenant_id, p_item, p_at_days, it.start_rollout + p_at_days, now(), auth.uid(), v_to)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'The % day review has already been requested or recorded', p_at_days::text using errcode = 'PV006';
  end;
  return v_id;
end $$;

create function public.record_outcome_review(p_item uuid, p_at_days integer, p_value numeric, p_adoption numeric, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_at_days not in (30, 60, 90) then raise exception 'The review is at 30, 60 or 90 days' using errcode = 'PV005'; end if;
  select i.id, i.tenant_id, i.start_rollout, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(it.tenant_id);
  if it.start_rollout is null then raise exception 'This initiative has no Start Roll-Out date yet, so the review has no due date' using errcode = 'PV005'; end if;
  if p_value is null and p_adoption is null and v_note is null then raise exception 'Enter at least a value, an adoption %% or a note' using errcode = 'PV005'; end if;
  if p_adoption is not null and (p_adoption < 0 or p_adoption > 100) then raise exception 'Adoption is a percentage from 0 to 100' using errcode = 'PV005'; end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'The note is at most 2000 characters' using errcode = 'PV005'; end if;
  insert into public.outcome_reviews (tenant_id, item_id, at_days, due_on, realised_kr_value, adoption_pct, notes, recorded_at, recorded_by)
  values (it.tenant_id, p_item, p_at_days, it.start_rollout + p_at_days, p_value, p_adoption, v_note, now(), auth.uid())
  on conflict (tenant_id, item_id, at_days) do update
    set realised_kr_value = excluded.realised_kr_value, adoption_pct = excluded.adoption_pct, notes = excluded.notes,
        recorded_at = excluded.recorded_at, recorded_by = excluded.recorded_by
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.outcome_reviews_notify(), public.request_outcome_review(uuid, integer), public.record_outcome_review(uuid, integer, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.request_outcome_review(uuid, integer), public.record_outcome_review(uuid, integer, numeric, numeric, text) to authenticated;
