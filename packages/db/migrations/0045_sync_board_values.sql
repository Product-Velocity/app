-- 0045: Sync with GitHub: Priority, Initiative Group, Due date and Size changed on the GitHub Project board (issue #197, docs/21).
-- 1. sync_base_valid() also accepts the four board keys (priority, group, due, size): hashes only, as for the texts.
-- 2. github_apply_pull() can now also take over, when a person chose Keep GitHub, exactly four more columns: moscow, theme,
--    end_date, effort. Every other key is still refused. Values are checked here as well as in the app:
--    moscow is Must, Should or Could; effort is XS to XL; end_date is a real date (and not before Planned Start, by the table's own
--    check); theme must already be an Initiative Group of the workspace (a group is never created from GitHub).
-- create or replace only: no DROP statements.
create or replace function public.sync_base_valid(b jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select b is null or (
    jsonb_typeof(b) = 'object'
    and not exists (select 1 from jsonb_each_text(b) e where e.key not in ('title', 'summary', 'description', 'hypothesis', 'priority', 'group', 'due', 'size') or e.value !~ '^[0-9a-f]{64}$')
  )
$$;

create or replace function public.github_apply_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  k text;
  v_old public.items%rowtype;
  v_changed jsonb := '{}'::jsonb;
  v_group text;
  v_date date;
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
    if k not in ('initiative_name', 'summary', 'description', 'hypothesis', 'moscow', 'theme', 'end_date', 'effort') then
      raise exception 'The field % cannot be taken over from GitHub.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  if p_fields ? 'initiative_name' and char_length(btrim(p_fields ->> 'initiative_name')) = 0 then
    raise exception 'An initiative needs a name.' using errcode = '22023';
  end if;
  if p_fields ? 'moscow' and (p_fields ->> 'moscow') not in ('Must', 'Should', 'Could') then
    raise exception 'GitHub cannot set MoSCoW to %.', p_fields ->> 'moscow' using errcode = '22023';
  end if;
  if p_fields ? 'effort' and (p_fields ->> 'effort') not in ('XS', 'S', 'M', 'L', 'XL') then
    raise exception 'GitHub cannot set the size to %.', p_fields ->> 'effort' using errcode = '22023';
  end if;
  if p_fields ? 'end_date' then
    begin
      v_date := (p_fields ->> 'end_date')::date;
    exception when others then
      raise exception 'The date % is not valid.', p_fields ->> 'end_date' using errcode = '22023';
    end;
    if (p_fields ->> 'end_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The date % is not valid.', p_fields ->> 'end_date' using errcode = '22023'; end if;
  end if;
  if p_fields ? 'theme' then
    select g.name into v_group from public.item_groups g where g.tenant_id = v_tenant and lower(g.name) = lower(btrim(p_fields ->> 'theme'));
    if v_group is null then raise exception 'The Initiative Group % does not exist in this workspace.', p_fields ->> 'theme' using errcode = '22023'; end if;
  end if;
  select * into v_old from public.items where id = p_item for update;

  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set
    initiative_name = case when p_fields ? 'initiative_name' then left(btrim(p_fields ->> 'initiative_name'), 300) else initiative_name end,
    summary = case when p_fields ? 'summary' then nullif(left(p_fields ->> 'summary', 4000), '') else summary end,
    description = case when p_fields ? 'description' then nullif(left(p_fields ->> 'description', 20000), '') else description end,
    hypothesis = case when p_fields ? 'hypothesis' then nullif(left(p_fields ->> 'hypothesis', 8000), '') else hypothesis end,
    moscow = case when p_fields ? 'moscow' then p_fields ->> 'moscow' else moscow end,
    theme = case when p_fields ? 'theme' then v_group else theme end,
    end_date = case when p_fields ? 'end_date' then v_date else end_date end,
    effort = case when p_fields ? 'effort' then p_fields ->> 'effort' else effort end
  where id = p_item;

  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k
      when 'initiative_name' then v_old.initiative_name when 'summary' then v_old.summary
      when 'description' then v_old.description when 'hypothesis' then v_old.hypothesis
      when 'moscow' then v_old.moscow when 'theme' then v_old.theme
      when 'end_date' then v_old.end_date::text else v_old.effort end);
  end loop;
  if p_base is not null then perform public.github_record_base(p_actor, p_item, p_base); end if;
  return v_changed; -- the values that were replaced, for the undo step
end $$;
