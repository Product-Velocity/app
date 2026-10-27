-- 0044: Sync with GitHub, slice 2 (issue #197, docs/21).
-- 1. item_github_links.sync_base: for the name and the three texts, the sha256 of the text both sides agreed on at the last sync
--    (hashes only, never the text), and sync_checked_at, the time of the last successful comparison.
-- 2. github_record_base(): stores the base after a send, a pull or an "in step" comparison. Server only.
-- 3. github_apply_pull(): applies texts that a person chose to take over from GitHub. It can change ONLY the four allowlisted
--    columns (initiative_name, summary, description, hypothesis); any other key is refused. Creators and admins only; the audit log
--    records the person and the source of the write like any edit, so undo works from it.
-- Additive only: no DROP statements.
create function public.sync_base_valid(b jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select b is null or (
    jsonb_typeof(b) = 'object'
    and not exists (select 1 from jsonb_each_text(b) e where e.key not in ('title', 'summary', 'description', 'hypothesis') or e.value !~ '^[0-9a-f]{64}$')
  )
$$;
alter table public.item_github_links
  add column sync_base jsonb check (public.sync_base_valid(sync_base)),
  add column sync_checked_at timestamptz;

create or replace function public.github_record_base(p_actor uuid, p_item uuid, p_base jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can sync an item with GitHub.' using errcode = '42501';
  end if;
  if p_base is null or jsonb_typeof(p_base) <> 'object' then raise exception 'bad base' using errcode = '22023'; end if;
  update public.item_github_links l
     set sync_base = coalesce(l.sync_base, '{}'::jsonb) || p_base, sync_checked_at = now()
   where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push';
  if not found then raise exception 'This item has no GitHub link that can be synced.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.github_record_base(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.github_record_base(uuid, uuid, jsonb) to service_role;

create or replace function public.github_apply_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  k text;
  v_old public.items%rowtype;
  v_changed jsonb := '{}'::jsonb;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can take over text from GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push' and l.issue_number is not null) then
    raise exception 'This item has no GitHub issue that can be synced.' using errcode = 'P0002';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'bad fields' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('initiative_name', 'summary', 'description', 'hypothesis') then
      raise exception 'The field % cannot be taken over from GitHub.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  if p_fields ? 'initiative_name' and char_length(btrim(p_fields ->> 'initiative_name')) = 0 then
    raise exception 'An initiative needs a name.' using errcode = '22023';
  end if;
  select * into v_old from public.items where id = p_item for update;

  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set
    initiative_name = case when p_fields ? 'initiative_name' then left(btrim(p_fields ->> 'initiative_name'), 300) else initiative_name end,
    summary = case when p_fields ? 'summary' then nullif(left(p_fields ->> 'summary', 4000), '') else summary end,
    description = case when p_fields ? 'description' then nullif(left(p_fields ->> 'description', 20000), '') else description end,
    hypothesis = case when p_fields ? 'hypothesis' then nullif(left(p_fields ->> 'hypothesis', 8000), '') else hypothesis end
  where id = p_item;

  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k
      when 'initiative_name' then v_old.initiative_name when 'summary' then v_old.summary
      when 'description' then v_old.description else v_old.hypothesis end);
  end loop;
  if p_base is not null then perform public.github_record_base(p_actor, p_item, p_base); end if;
  return v_changed; -- the values that were replaced, for the undo step
end $$;
revoke all on function public.github_apply_pull(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.github_apply_pull(uuid, uuid, jsonb, jsonb) to service_role;
