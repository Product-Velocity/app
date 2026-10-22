-- 0013: Initiative Group (items.theme) is an open list per workspace (request R-005, issue #38).
-- items.theme keeps holding the group name as text; item_groups is the workspace's list of names, so the picker can
-- autocomplete and admins can rename, merge and retire. A group is created the first time someone types it
-- (items_ensure_group), in the spelling of an existing group when only the case differs.
-- No DROP statements: applied to Supabase through a tool that pauses on them.

create table public.item_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id)
);
create unique index item_groups_name_unique on public.item_groups (tenant_id, lower(name));

create trigger item_groups_meta before insert or update on public.item_groups
  for each row execute function public.set_write_meta();
create trigger item_groups_audit after insert or update or delete on public.item_groups
  for each row execute function public.audit_row();

alter table public.item_groups enable row level security;
create policy item_groups_select on public.item_groups for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
-- editors add groups (by typing one); renaming, merging and retiring go through the admin-only functions below
create policy item_groups_insert on public.item_groups for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.item_groups from public, anon, authenticated;
grant select on public.item_groups to authenticated;
grant insert (id, tenant_id, name) on public.item_groups to authenticated;

-- ---------------------------------------------------------------------------
-- typing a group on an item creates it when it is new
-- ---------------------------------------------------------------------------
create function public.items_ensure_group() returns trigger
language plpgsql set search_path = '' as $$
declare existing text;
begin
  if new.theme is null then return new; end if;
  new.theme := btrim(new.theme);
  if new.theme = '' then new.theme := null; return new; end if;
  select name into existing from public.item_groups where tenant_id = new.tenant_id and lower(name) = lower(new.theme);
  if existing is not null then
    new.theme := existing;
  else
    insert into public.item_groups (tenant_id, name) values (new.tenant_id, new.theme) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger items_ensure_group before insert or update of theme on public.items
  for each row execute function public.items_ensure_group();

-- groups that already exist as text on items (one spelling per name, ignoring case)
insert into public.item_groups (tenant_id, name)
  select distinct on (tenant_id, lower(btrim(theme))) tenant_id, btrim(theme)
  from public.items where theme is not null and btrim(theme) <> ''
  order by tenant_id, lower(btrim(theme)), btrim(theme);

-- ---------------------------------------------------------------------------
-- admin tidy-up. security definer so the admin check is explicit and the per-item changes are one transaction;
-- the audit log still records the signed-in admin and the source for every item changed.
-- ---------------------------------------------------------------------------
create function public.rename_item_group(p_group uuid, p_name text) returns integer
language plpgsql security definer set search_path = '' as $$
declare g public.item_groups; n integer; new_name text := btrim(p_name);
begin
  select * into g from public.item_groups where id = p_group;
  if not found or g.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'That group does not exist or you cannot change it.' using errcode = '42501';
  end if;
  if char_length(new_name) not between 1 and 120 then raise exception 'Give the group a name of 1 to 120 characters.' using errcode = '23514'; end if;
  update public.item_groups set name = new_name where id = p_group;
  update public.items set theme = new_name where tenant_id = g.tenant_id and theme = g.name;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.merge_item_groups(p_from uuid, p_into uuid) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare a public.item_groups; b public.item_groups; moved uuid[];
begin
  select * into a from public.item_groups where id = p_from;
  select * into b from public.item_groups where id = p_into;
  if a.id is null or b.id is null
     or a.tenant_id <> all (array (select public.my_admin_tenant_ids()))
     or b.tenant_id <> all (array (select public.my_admin_tenant_ids()))
     or a.tenant_id <> b.tenant_id then
    raise exception 'Those groups do not exist or you cannot change them.' using errcode = '42501';
  end if;
  if a.id = b.id then raise exception 'Choose two different groups.' using errcode = '23514'; end if;
  moved := array (select id from public.items where tenant_id = a.tenant_id and theme = a.name);
  update public.items set theme = b.name where id = any (moved);
  delete from public.item_groups where id = a.id;
  return moved;
end $$;

-- undo of a merge: brings the group back and returns the moved items that are still in the target group
create function public.restore_merged_group(p_tenant uuid, p_name text, p_into_name text, p_items uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change these groups.' using errcode = '42501';
  end if;
  insert into public.item_groups (tenant_id, name) values (p_tenant, btrim(p_name)) on conflict do nothing;
  update public.items set theme = btrim(p_name) where tenant_id = p_tenant and id = any (p_items) and theme = p_into_name;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.retire_item_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.item_groups;
begin
  select * into g from public.item_groups where id = p_group;
  if not found or g.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'That group does not exist or you cannot change it.' using errcode = '42501';
  end if;
  if exists (select 1 from public.items where tenant_id = g.tenant_id and theme = g.name) then
    raise exception 'That group still has initiatives. Merge it into another group instead.' using errcode = '23503';
  end if;
  delete from public.item_groups where id = p_group;
end $$;

revoke all on function public.rename_item_group(uuid, text), public.merge_item_groups(uuid, uuid),
  public.restore_merged_group(uuid, text, text, uuid[]), public.retire_item_group(uuid) from public, anon;
grant execute on function public.rename_item_group(uuid, text), public.merge_item_groups(uuid, uuid),
  public.restore_merged_group(uuid, text, text, uuid[]), public.retire_item_group(uuid) to authenticated;

-- the tidy-up screen: every group with the number of initiatives in it (row security applies: members read their workspace)
create index items_theme_idx on public.items (tenant_id, theme);
create function public.item_group_usage(p_tenant uuid) returns table (id uuid, name text, items bigint)
language sql stable set search_path = '' as $$
  select g.id, g.name, count(i.id)
  from public.item_groups g
  left join public.items i on i.tenant_id = g.tenant_id and i.theme = g.name
  where g.tenant_id = p_tenant
  group by g.id, g.name
  order by lower(g.name)
$$;
revoke all on function public.item_group_usage(uuid) from public, anon;
grant execute on function public.item_group_usage(uuid) to authenticated;
