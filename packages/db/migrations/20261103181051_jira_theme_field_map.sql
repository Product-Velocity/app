-- Jira, field mapping: the Theme field (the Initiative Group name is also written into a Jira text field the admin chooses, per project).
-- jira_project_links.field_map gets one more optional key: "theme": "customfield_NNNN" (same pattern as startDate).
-- Functions replaced by this migration: public.jira_set_field_map(uuid, jsonb) (from 20261103102116_jira_field_map.sql; same signature, so CREATE OR
--   REPLACE keeps its grants; the rules are unchanged: a human workspace admin only, never Claude, a service account or platform staff).
--   No other open branch replaces it (checked against the remote branches on 2026-11-03). No DROP statements, no table change.
-- Before this is applied the app keeps working: saving a mapping WITHOUT a theme still succeeds; only saving one with a theme is refused.

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
