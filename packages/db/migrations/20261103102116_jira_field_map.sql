-- Jira, field mapping per project (issue #67, #70): how this Jira project spells the fields Sync may fill beyond name, description and labels.
-- jira_project_links.field_map = {"startDate": "customfield_10015", "priorityByMoscow": {"Must": "1", "Should": "2", ...}}.
--   startDate: the id of the site's own Start date field (custom field ids differ per site). priorityByMoscow: the id of the Jira priority
--   that stands for each MoSCoW value. Both optional; an unmapped value is skipped with a note in the Sync preview, never guessed.
-- jira_set_field_map(project, map): a human workspace admin only (never Claude, never a service account, never platform staff), validated here,
--   audited by the existing audit trigger of jira_project_links. Nothing is written to Jira by it.
-- Functions replaced by this migration: none. No DROP statements.

alter table public.jira_project_links
  add column field_map jsonb not null default '{}'::jsonb check (jsonb_typeof(field_map) = 'object');

create function public.jira_set_field_map(p_project uuid, p_map jsonb) returns void
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
    if k not in ('startDate', 'priorityByMoscow') then raise exception 'The mapping key % is not allowed.', k using errcode = '22023'; end if;
  end loop;
  if p_map ? 'startDate' and (jsonb_typeof(p_map -> 'startDate') <> 'string' or (p_map ->> 'startDate') !~ '^customfield_[0-9]{1,9}$') then
    raise exception 'The start date must be a custom field of the Jira site.' using errcode = '22023';
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
