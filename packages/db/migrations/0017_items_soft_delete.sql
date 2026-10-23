-- 0017: delete initiatives with a Trash (#52, R-020).
--
-- A delete is a soft delete: deleted_at / deleted_by are set, the row stays. RLS hides deleted rows from every
-- query (grid, Gantt, cards, scopes, reports, counts), so nothing can leak by forgetting a filter. Deleted items are
-- read through trashed_items() (creators and admins), brought back with restore_items(), and removed for good with
-- purge_items() (admins only, only from the Trash) or purge_old_trash() (service role, 30 days).
--
-- Ranks: live items keep ranks 1..N (the gap closes on delete, as before). A deleted item keeps its old rank as the
-- place to come back to; restore inserts it there and shifts the others down. The rank uniqueness therefore only
-- applies to live items: the unique constraint becomes an exclusion constraint with the same behaviour (deferred, one
-- rank list per tenant and cycle) plus "where deleted_at is null". Item codes are never reused (the counter only grows).
--
-- Who may delete: admins any item; creators the items they created; viewers, commenters and leadership none.
-- Claude and service accounts never delete, restore or purge (PV004); Claude may propose, a person confirms.
-- The direct DELETE grant on items is removed: the only ways to remove a row are the functions below.

alter table public.items
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index items_trash_idx on public.items (tenant_id, deleted_at) where deleted_at is not null;

-- rank uniqueness for live items only (same deferred behaviour as before; a missing cycle counts as one cycle)
alter table public.items drop constraint items_rank_unique;
alter table public.items add constraint items_rank_unique
  exclude using btree (tenant_id with =, (coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =, stack_rank with =)
  where (deleted_at is null) deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- RLS: deleted rows are invisible and cannot be edited; nobody deletes rows directly
-- ---------------------------------------------------------------------------
alter policy items_select on public.items
  using (tenant_id = any (array (select public.my_tenant_ids())) and deleted_at is null);
alter policy items_update on public.items
  using (tenant_id = any (array (select public.my_editor_tenant_ids())) and deleted_at is null)
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
alter policy items_delete on public.items using (false);
revoke delete on public.items from authenticated;

-- ---------------------------------------------------------------------------
-- Rank behaviour counts live items only
-- ---------------------------------------------------------------------------
create or replace function public.items_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into pv_internal.item_counters (tenant_id, last_number) values (new.tenant_id, 1)
  on conflict (tenant_id) do update set last_number = pv_internal.item_counters.last_number + 1
  returning last_number into n;
  -- lpad() truncates, so numbers above 99 are not padded (see 0009)
  new.item_code := 'R-' || case when n < 100 then lpad(n::text, 2, '0') else n::text end;
  select coalesce(max(i.stack_rank), 0) + 1 into new.stack_rank
    from public.items i
   where i.tenant_id = new.tenant_id and i.cycle_id is not distinct from new.cycle_id and i.deleted_at is null;
  return new;
end $$;

create or replace function public.move_item(p_item uuid, p_new_rank int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_cycle uuid; v_old int; v_max int; v_new int;
begin
  select i.tenant_id, i.cycle_id, i.stack_rank into v_tenant, v_cycle, v_old
    from public.items i where i.id = p_item and i.deleted_at is null;
  if v_tenant is null or not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.role in ('creator', 'admin')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if public.write_source() = 'Claude MCP' or exists (
    select 1 from public.tenant_members m
     where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot set Stack Rank' using errcode = 'PV004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || coalesce(v_cycle::text, ''), 0));
  select i.stack_rank into v_old from public.items i where i.id = p_item;
  select max(i.stack_rank) into v_max from public.items i
   where i.tenant_id = v_tenant and i.cycle_id is not distinct from v_cycle and i.deleted_at is null;
  v_new := greatest(1, least(coalesce(p_new_rank, 1), v_max));
  if v_new = v_old then return; end if;

  perform set_config('pv.rank_internal', 'on', true);
  if v_new < v_old then
    update public.items set stack_rank = stack_rank + 1
     where tenant_id = v_tenant and cycle_id is not distinct from v_cycle and deleted_at is null
       and stack_rank >= v_new and stack_rank < v_old;
  else
    update public.items set stack_rank = stack_rank - 1
     where tenant_id = v_tenant and cycle_id is not distinct from v_cycle and deleted_at is null
       and stack_rank > v_old and stack_rank <= v_new;
  end if;
  update public.items set stack_rank = v_new, previous_rank = v_old where id = p_item;
  perform set_config('pv.rank_internal', 'off', true);
end $$;

-- Close the gaps of the rank lists named by the two arrays (same position = one tenant and cycle). Live items only.
create function pv_internal.compact_ranks(p_tenants uuid[], p_cycles uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('pv.rank_internal', 'on', true);
  with pairs as (select distinct t as tenant_id, c as cycle_id from unnest(p_tenants, p_cycles) as u(t, c)),
  ranked as (
    select i.id, row_number() over (partition by i.tenant_id, i.cycle_id order by i.stack_rank) as rn
      from public.items i
      join pairs p on p.tenant_id = i.tenant_id and p.cycle_id is not distinct from i.cycle_id
     where i.deleted_at is null
  )
  update public.items i set stack_rank = r.rn from ranked r where i.id = r.id and i.stack_rank <> r.rn;
  perform set_config('pv.rank_internal', 'off', true);
end $$;

-- A real delete (undo of a quick-add, or Delete forever) still closes the gaps.
create or replace function public.items_compact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('pv.rank_internal', 'on', true);
  with pairs as (select distinct tenant_id, cycle_id from deleted where deleted_at is null),
  ranked as (
    select i.id, row_number() over (partition by i.tenant_id, i.cycle_id order by i.stack_rank) as rn
      from public.items i
      join pairs p on p.tenant_id = i.tenant_id and p.cycle_id is not distinct from i.cycle_id
     where i.deleted_at is null
  )
  update public.items i set stack_rank = r.rn from ranked r where i.id = r.id and i.stack_rank <> r.rn;
  perform set_config('pv.rank_internal', 'off', true);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Audit: Delete forever keeps the item code and name only (no personal or commercial fields)
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_tenant uuid := (case when tg_table_name = 'tenants' then v_row ->> 'id'
                         else v_row ->> 'tenant_id' end)::uuid;
  v_minimal boolean := tg_op = 'DELETE' and coalesce(current_setting('pv.audit_minimal', true), '') = 'on';
  k text;
begin
  if v_minimal and tg_table_name <> 'items' then
    return null; -- rows that go with a purged item: the item's own entry says what was removed
  end if;
  for k in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new)
    ) s
    where key <> 'updated_at' and (not v_minimal or key in ('item_code', 'initiative_name'))
  loop
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (v_tenant, tg_table_name, (v_row ->> 'id')::uuid, k, v_old -> k, v_new -> k,
              auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- The functions people call
-- ---------------------------------------------------------------------------
-- Every one refuses Claude and service accounts, takes a list, and answers per item, so one problem does not stop the rest.
create function pv_internal.refuse_claude() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.write_source() = 'Claude MCP' or exists (
    select 1 from public.tenant_members m where m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot delete, restore or remove items; ask a person' using errcode = 'PV004';
  end if;
end $$;

create function public.delete_items(p_ids uuid[]) returns table (id uuid, ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ok uuid[] := '{}'; v_pt uuid[] := '{}'; v_pc uuid[] := '{}';
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.tenant_id, i.cycle_id, i.created_by, i.deleted_at, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
     order by i.tenant_id, i.cycle_id nulls first, q.rid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.deleted_at is not null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'It is already in the Trash.'::text;
    elsif r.role = 'admin' or (r.role = 'creator' and r.created_by = v_uid) then
      v_rok := v_rok || true; v_rreason := v_rreason || null::text;
      v_ok := v_ok || r.rid; v_pt := v_pt || r.tenant_id; v_pc := v_pc || r.cycle_id;
    elsif r.role = 'creator' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only the person who added it or an admin can delete it.'::text;
    else
      v_rok := v_rok || false; v_rreason := v_rreason || 'Your role cannot delete initiatives.'::text;
    end if;
  end loop;

  if cardinality(v_ok) > 0 then
    -- lock each rank list (same key as move_item), then mark and close the gaps in this one transaction
    perform pg_advisory_xact_lock(hashtextextended(t.tenant::text || coalesce(t.cyc::text, ''), 0))
      from (select distinct a as tenant, b as cyc from unnest(v_pt, v_pc) as x(a, b) order by 1, 2) t;
    update public.items i set deleted_at = now(), deleted_by = v_uid where i.id = any (v_ok);
    perform pv_internal.compact_ranks(v_pt, v_pc);
  end if;
  return query select * from unnest(v_rid, v_rok, v_rreason);
end $$;

create function public.restore_items(p_ids uuid[]) returns table (id uuid, ok boolean, reason text, stack_rank int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r record; g record; x record;
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
  v_ok uuid[] := '{}'; v_pt uuid[] := '{}'; v_pc uuid[] := '{}';
  v_order uuid[]; v_pos int; v_restored uuid[];
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.tenant_id, i.cycle_id, i.created_by, i.deleted_at, i.deleted_by, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
     order by i.tenant_id, q.rid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.deleted_at is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'It is not in the Trash.'::text;
    elsif r.role = 'admin' or (r.role = 'creator' and v_uid in (r.created_by, r.deleted_by)) then
      v_rok := v_rok || true; v_rreason := v_rreason || null::text;
      v_ok := v_ok || r.rid; v_pt := v_pt || r.tenant_id; v_pc := v_pc || r.cycle_id;
    elsif r.role = 'creator' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only the person who added or deleted it, or an admin, can restore it.'::text;
    else
      v_rok := v_rok || false; v_rreason := v_rreason || 'Your role cannot restore initiatives.'::text;
    end if;
  end loop;

  for g in select distinct a as tenant, b as cyc from unnest(v_pt, v_pc) as u(a, b) order by 1, 2 loop
    perform pg_advisory_xact_lock(hashtextextended(g.tenant::text || coalesce(g.cyc::text, ''), 0));
    select coalesce(array_agg(i.id order by i.stack_rank), '{}') into v_order
      from public.items i where i.tenant_id = g.tenant and i.cycle_id is not distinct from g.cyc and i.deleted_at is null;
    v_restored := '{}';
    -- oldest rank first, each back at its old place (or the end if the list is now shorter)
    for x in
      select i.id, i.stack_rank from public.items i
       where i.id = any (v_ok) and i.tenant_id = g.tenant and i.cycle_id is not distinct from g.cyc
       order by i.stack_rank, i.id
    loop
      v_pos := least(x.stack_rank, cardinality(v_order) + 1);
      v_order := v_order[1:v_pos - 1] || x.id || v_order[v_pos:];
      v_restored := v_restored || x.id;
    end loop;
    perform set_config('pv.rank_internal', 'on', true);
    update public.items i
       set stack_rank = n.pos::int,
           deleted_at = case when i.id = any (v_restored) then null else i.deleted_at end,
           deleted_by = case when i.id = any (v_restored) then null else i.deleted_by end
      from unnest(v_order) with ordinality as n(item, pos)
     where i.id = n.item and (i.stack_rank <> n.pos or i.id = any (v_restored));
    perform set_config('pv.rank_internal', 'off', true);
  end loop;
  return query
    select u.rid, u.ok, u.reason, i.stack_rank
      from unnest(v_rid, v_rok, v_rreason) as u(rid, ok, reason)
      left join public.items i on i.id = u.rid and u.ok;
end $$;

-- Delete forever: admins only, and only what is already in the Trash.
create function public.purge_items(p_ids uuid[]) returns table (id uuid, ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ok uuid[] := '{}';
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.deleted_at, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.role <> 'admin' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only an admin can delete items forever.'::text;
    elsif r.deleted_at is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only items in the Trash can be deleted forever.'::text;
    else
      v_rok := v_rok || true; v_rreason := v_rreason || null::text; v_ok := v_ok || r.rid;
    end if;
  end loop;
  if cardinality(v_ok) > 0 then
    perform set_config('pv.audit_minimal', 'on', true);
    delete from public.items i where i.id = any (v_ok);
    perform set_config('pv.audit_minimal', 'off', true);
  end if;
  return query select * from unnest(v_rid, v_rok, v_rreason);
end $$;

-- The 30-day clean-up, for a scheduled job running as the service role.
create function public.purge_old_trash(p_days int default 30) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform set_config('pv.audit_minimal', 'on', true);
  with gone as (
    delete from public.items i where i.deleted_at < now() - make_interval(days => greatest(p_days, 1)) returning 1
  ) select count(*) into n from gone;
  perform set_config('pv.audit_minimal', 'off', true);
  return n;
end $$;

-- Undo of a quick-add: the person who added it, within 15 minutes, removes it completely (no Trash).
create function public.discard_new_items(p_ids uuid[]) returns table (id uuid, ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ok uuid[] := '{}';
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.created_by, i.created_at, i.deleted_at, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role not in ('creator', 'admin') then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.created_by is distinct from v_uid or r.created_at < now() - interval '15 minutes' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only the person who just added it can take it back; use Delete instead.'::text;
    else
      v_rok := v_rok || true; v_rreason := v_rreason || null::text; v_ok := v_ok || r.rid;
    end if;
  end loop;
  if cardinality(v_ok) > 0 then
    delete from public.items i where i.id = any (v_ok);
  end if;
  return query select * from unnest(v_rid, v_rok, v_rreason);
end $$;

-- The Trash: creators and admins of the workspace see what was deleted, by whom and when. No commercial fields.
create function public.trashed_items(p_tenant uuid)
returns table (id uuid, item_code text, initiative_name text, home_project_id uuid, theme text, stack_rank int,
               created_by uuid, deleted_at timestamptz, deleted_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot see the Trash of that workspace.' using errcode = '42501';
  end if;
  return query
    select i.id, i.item_code, i.initiative_name, i.home_project_id, i.theme, i.stack_rank, i.created_by, i.deleted_at, i.deleted_by
      from public.items i
     where i.tenant_id = p_tenant and i.deleted_at is not null
     order by i.deleted_at desc, i.item_code
     limit 2000;
end $$;

-- ---------------------------------------------------------------------------
-- Other readers that run with their own rights must not show deleted items either
-- ---------------------------------------------------------------------------
create or replace function public.weekly_item_changes(p_tenant uuid, p_since timestamptz)
returns table (item_id uuid, field text, old jsonb, new jsonb, at timestamptz, actor_id uuid, via text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select a.entity_id, a.field, a.old, a.new, a.at, a.actor_id, a.via
    from public.audit_log a
    where a.tenant_id = p_tenant and a.entity = 'items' and a.field in ('stack_rank', 'status', 'health') and a.at >= p_since
      and exists (select 1 from public.items i where i.id = a.entity_id and i.deleted_at is null)
    order by a.at, a.id
    limit 5000;
end $$;

create or replace function public.item_activity(p_item uuid, p_limit integer default 200)
returns table (id bigint, at timestamptz, entity text, entity_id uuid, field text, old jsonb, new jsonb, actor_id uuid, via text)
language plpgsql stable security definer set search_path = '' as $$
declare t uuid;
begin
  select i.tenant_id into t from public.items i where i.id = p_item and i.deleted_at is null;
  if t is null or t <> all (array (select public.my_tenant_ids())) then
    raise exception 'That item does not exist or you cannot read it.' using errcode = '42501';
  end if;
  return query
    select a.id, a.at, a.entity, a.entity_id, a.field, a.old, a.new, a.actor_id, a.via
    from public.audit_log a
    where a.tenant_id = t
      and a.field not in ('tenant_id', 'created_at', 'created_by', 'created_via', 'updated_at')
      and (
        (a.entity = 'items' and a.entity_id = p_item)
        or (a.entity in ('item_tags', 'item_links', 'item_files', 'item_relations', 'item_teams')
            and a.entity_id in (
              select x.entity_id from public.audit_log x
              where x.tenant_id = t and x.field = 'item_id' and x.entity in ('item_tags', 'item_links', 'item_files', 'item_relations', 'item_teams')
                and (x.new #>> '{}' = p_item::text or x.old #>> '{}' = p_item::text)))
      )
    order by a.at desc, a.id desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function pv_internal.compact_ranks(uuid[], uuid[]), pv_internal.refuse_claude() from public, anon, authenticated;
revoke all on function public.delete_items(uuid[]), public.restore_items(uuid[]), public.purge_items(uuid[]),
  public.discard_new_items(uuid[]), public.trashed_items(uuid), public.purge_old_trash(int) from public, anon, authenticated;
grant execute on function public.delete_items(uuid[]), public.restore_items(uuid[]), public.purge_items(uuid[]),
  public.discard_new_items(uuid[]), public.trashed_items(uuid) to authenticated;
grant execute on function public.purge_old_trash(int) to service_role;
