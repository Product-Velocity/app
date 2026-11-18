-- Ashu (2026-11-18): three field changes. Forward-only; every statement keeps the existing rows (decision docs/decisions/2026-11-18-open-owner-category-change-type.md).
--
-- 1. Change Type values are renamed: "New feature" is now "Feature" and "Improvement to existing feature" is now "Improvement" (Bug and Tech debt unchanged).
--    The rows and the saved views / default views that filter on the old names move to the new names; the check on items.change_type is replaced.
-- 2. Roadmap Category (roadmap_category) stops being a fixed list and becomes an open list like Focus Area: any text up to 120 characters.
--    The old five values stay as they are (they are only text now); nothing is seeded.
-- 3. Owner (sponsor) stops being a link to a workspace member and becomes an open list: any text up to 120 characters (a name or an email address).
--    Each existing owner is kept as the member's email address, which is what the grid showed. The foreign key to tenant_members is dropped.
--
-- Functions replaced by this migration: github_copy_issue_labels(uuid, uuid, text, text) and jira_copy_issue_labels(uuid, uuid, text, text), only to allow the
-- new Change Type names (copied from 20261109112911 and 20261109191636; no other change). No DROP statements except the three constraints replaced below.

-- 1. Change Type
alter table public.items drop constraint if exists items_change_type_check;
update public.items set change_type = case change_type when 'New feature' then 'Feature' when 'Improvement to existing feature' then 'Improvement' end
  where change_type in ('New feature', 'Improvement to existing feature');
alter table public.items add constraint items_change_type_check check (change_type in ('Feature', 'Improvement', 'Bug', 'Tech debt'));
update public.saved_views set filters = replace(replace(filters::text, '"New feature"', '"Feature"'), '"Improvement to existing feature"', '"Improvement"')::jsonb
  where filters::text like '%"New feature"%' or filters::text like '%"Improvement to existing feature"%';

-- 2. Roadmap Category: an open list
alter table public.items drop constraint if exists items_roadmap_category_check;
alter table public.items add constraint items_roadmap_category_check check (char_length(roadmap_category) <= 120);

-- 3. Owner: an open list
alter table public.items drop constraint if exists items_sponsor_fk;
-- items_computed expands items.* in its stored query, so PostgreSQL will not change the type of a column it uses: drop it, change the column, and create it again
-- from its own stored definition (same text, same options, same grant), so the view is exactly what the earlier migrations made.
do $$
declare v_def text := pg_get_viewdef('public.items_computed'::regclass, true);
begin
  drop view public.items_computed;
  alter table public.items alter column sponsor type text using sponsor::text;
  execute 'create view public.items_computed with (security_invoker = true) as ' || v_def;
  grant select on public.items_computed to authenticated;
end $$;
update public.items i set sponsor = left((select u.email::text from public.tenant_members m join auth.users u on u.id = m.user_id
    where m.tenant_id = i.tenant_id and m.user_id::text = i.sponsor), 120)
  where i.sponsor is not null;
alter table public.items add constraint items_sponsor_check check (char_length(sponsor) <= 120);

-- Pull-in labels (GitHub)
create or replace function public.github_copy_issue_labels(p_actor uuid, p_item uuid, p_change_type text, p_focus_area text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_change text;
  v_focus text;
  v_out jsonb := '{}'::jsonb;
  v_area text := nullif(btrim(left(coalesce(p_focus_area, ''), 120)), '');
begin
  select tenant_id, change_type, focus_area into v_tenant, v_change, v_focus from public.items where id = p_item and deleted_at is null for update;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can copy the labels of a GitHub issue.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.items i join public.item_github_links l on l.item_id = i.id and l.tenant_id = i.tenant_id
    where i.id = p_item and i.source like 'GitHub issue #%'
  ) then
    raise exception 'This initiative was not pulled in from a GitHub issue.' using errcode = 'P0002';
  end if;
  if p_change_type is not null and p_change_type not in ('Feature', 'Improvement', 'Bug') then
    raise exception 'GitHub cannot set Change Type to %.', p_change_type using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who pulled it in
  if p_change_type is not null and v_change is null then
    update public.items set change_type = p_change_type where id = p_item;
    v_out := v_out || jsonb_build_object('change_type', true);
  end if;
  if v_area is not null and nullif(btrim(coalesce(v_focus, '')), '') is null then
    update public.items set focus_area = v_area where id = p_item;
    v_out := v_out || jsonb_build_object('focus_area', true);
  end if;
  return v_out;
end $$;
revoke all on function public.github_copy_issue_labels(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.github_copy_issue_labels(uuid, uuid, text, text) to service_role;

-- Pull-in labels (Jira)
create or replace function public.jira_copy_issue_labels(p_actor uuid, p_item uuid, p_change_type text, p_focus_area text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_change text;
  v_focus text;
  v_out jsonb := '{}'::jsonb;
  v_area text := nullif(btrim(left(coalesce(p_focus_area, ''), 120)), '');
begin
  select tenant_id, change_type, focus_area into v_tenant, v_change, v_focus from public.items where id = p_item and deleted_at is null for update;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can copy the labels of a Jira issue.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.items i join public.item_jira_links l on l.item_id = i.id and l.tenant_id = i.tenant_id
    where i.id = p_item and i.source like 'Jira issue %'
  ) then
    raise exception 'This initiative was not pulled in from a Jira issue.' using errcode = 'P0002';
  end if;
  if p_change_type is not null and p_change_type not in ('Feature', 'Improvement', 'Bug') then
    raise exception 'Jira cannot set Change Type to %.', p_change_type using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if p_change_type is not null and v_change is null then
    update public.items set change_type = p_change_type where id = p_item;
    v_out := v_out || jsonb_build_object('change_type', true);
  end if;
  if v_area is not null and nullif(btrim(coalesce(v_focus, '')), '') is null then
    update public.items set focus_area = v_area where id = p_item;
    v_out := v_out || jsonb_build_object('focus_area', true);
  end if;
  return v_out;
end $$;
revoke all on function public.jira_copy_issue_labels(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.jira_copy_issue_labels(uuid, uuid, text, text) to service_role;
