-- Business Value Type label ON by default; Jira "theme" field map receives the Focus Area (decision 2026-11-05-value-type-and-quarter-labels, Ashu 2026-11-05, issue #324).
-- Follows 20261105162014_value_quarter_labels_focus_field.sql (already applied; not edited). Functions replaced (same signatures, grants stay; rules unchanged):
--   public.tracker_set_field_config(uuid, jsonb): v_default_off no longer lists jira.label.value / github.label.value, so a row is kept only when one is switched OFF.
--   public.jira_set_field_map(uuid, jsonb): back to the keys startDate, theme, priorityByMoscow (the focusArea key of the previous migration is not used:
--     the "theme" field now carries the Focus Area, the Initiative Group goes only into a label).
-- No other open branch replaces these functions. No table change. A stored "focusArea" key, if any, is ignored by the app.

create or replace function public.tracker_set_field_config(p_project uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tracker text;
  r jsonb;
  v_slot text;
  v_enabled boolean;
  v_field text;
  v_slots text[] := '{}';
  v_allowed text[];
  -- switches that are OFF unless a person turns them on (the optional labels): the default is off, so a row is kept only when one is switched ON
  v_default_off constant text[] := array['jira.label.tags', 'jira.label.focus', 'github.label.tags', 'github.label.focus'];
begin
  select tenant_id, tracker into v_tenant, v_tracker from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change the field configuration.' using errcode = '42501';
  end if;
  if v_tracker is null or v_tracker not in ('github', 'jira') then
    raise exception 'That project has no GitHub or Jira tracker.' using errcode = 'P0002';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad configuration' using errcode = '22023'; end if;
  -- the closed list of slots a person may change (fixed slots and commercial fields are not on it)
  v_allowed := case v_tracker
    when 'jira' then array['jira.label.moscow', 'jira.label.rank', 'jira.label.type', 'jira.label.group', 'jira.label.project', 'jira.dueDate', 'jira.body.artifacts', 'jira.body.files', 'jira.label.tags', 'jira.label.focus', 'jira.label.value', 'jira.label.quarter']
    else array['github.label.moscow', 'github.label.rank', 'github.label.type', 'github.label.group', 'github.label.project', 'github.milestone', 'github.issueType', 'github.body.artifacts', 'github.body.files', 'github.label.tags', 'github.label.focus', 'github.label.value', 'github.label.quarter']
  end;
  for r in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'slot') is distinct from 'string' then raise exception 'bad configuration row' using errcode = '22023'; end if;
    v_slot := r ->> 'slot';
    if not (v_slot = any (v_allowed)) then raise exception 'The setting % can not be changed for % projects.', v_slot, v_tracker using errcode = '22023'; end if;
    if v_slot = any (v_slots) then raise exception 'The setting % appears twice.', v_slot using errcode = '22023'; end if;
    if r ? 'enabled' and jsonb_typeof(r -> 'enabled') <> 'boolean' then raise exception 'bad enabled flag' using errcode = '22023'; end if;
    v_enabled := coalesce((r ->> 'enabled')::boolean, true);
    v_field := case when jsonb_typeof(r -> 'field') = 'string' then r ->> 'field' else null end;
    if r ? 'field' and jsonb_typeof(r -> 'field') not in ('string', 'null') then raise exception 'bad field' using errcode = '22023'; end if;
    if v_field is not null and (v_slot <> 'jira.dueDate' or v_field !~ '^(duedate|customfield_[0-9]{1,9})$') then
      raise exception 'The setting % can not name the field %.', v_slot, v_field using errcode = '22023';
    end if;
    if not v_enabled and v_field is not null then raise exception 'A switched-off setting has no field.' using errcode = '22023'; end if;
    if v_enabled = not (v_slot = any (v_default_off)) and v_field is null then continue; end if; -- the default: no row
    v_slots := v_slots || v_slot;
    perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
    insert into public.tracker_field_config (tenant_id, project_id, provider, slot, enabled, field_id)
      values (v_tenant, p_project, v_tracker, v_slot, v_enabled, v_field)
      on conflict (project_id, slot) do update set enabled = excluded.enabled, field_id = excluded.field_id
        where (public.tracker_field_config.enabled, public.tracker_field_config.field_id) is distinct from (excluded.enabled, excluded.field_id);
  end loop;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  delete from public.tracker_field_config where project_id = p_project and tenant_id = v_tenant and not (slot = any (v_slots));
end $$;

create or replace function public.jira_set_field_map(p_project uuid, p_map jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  k text;
  m text;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change the Jira field mapping.' using errcode = '42501';
  end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object' then raise exception 'bad mapping' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_map) loop
    if k not in ('startDate', 'theme', 'priorityByMoscow') then raise exception 'The mapping key % is not allowed.', k using errcode = '22023'; end if;
  end loop;
  if p_map ? 'startDate' and (jsonb_typeof(p_map -> 'startDate') <> 'string' or (p_map ->> 'startDate') !~ '^customfield_[0-9]{1,9}$') then
    raise exception 'The start date must be a custom field of the Jira site.' using errcode = '22023';
  end if;
  if p_map ? 'theme' and (jsonb_typeof(p_map -> 'theme') <> 'string' or (p_map ->> 'theme') !~ '^customfield_[0-9]{1,9}$') then
    raise exception 'The theme must be a custom field of the Jira site.' using errcode = '22023';
  end if;
  if p_map ? 'priorityByMoscow' then
    if jsonb_typeof(p_map -> 'priorityByMoscow') <> 'object' then raise exception 'bad priority mapping' using errcode = '22023'; end if;
    for m in select jsonb_object_keys(p_map -> 'priorityByMoscow') loop
      if m not in ('Must', 'Should', 'Could', 'Won''t') then raise exception 'Unknown MoSCoW value %.', m using errcode = '22023'; end if;
      if jsonb_typeof(p_map -> 'priorityByMoscow' -> m) <> 'string' or (p_map -> 'priorityByMoscow' ->> m) !~ '^[0-9]{1,9}$' then
        raise exception 'The Jira priority for % must be a priority id.', m using errcode = '22023';
      end if;
    end loop;
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.jira_project_links set field_map = p_map where project_id = p_project and tenant_id = v_tenant;
  if not found then raise exception 'That project is not linked to a Jira project.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.jira_set_field_map(uuid, jsonb) from public, anon;
grant execute on function public.jira_set_field_map(uuid, jsonb) to authenticated;
