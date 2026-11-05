-- Optional labels for Tags, Focus Area and Roadmap Category on both trackers (issue #321, decision 2026-11-05-optional-field-labels).
-- Functions replaced by this migration (same signature, so the grants stay; nothing else is changed):
--   public.tracker_set_field_config(uuid, jsonb)  (20261103233355_tracker_field_config.sql, replaced by 20261104220831_jira_description_sections.sql):
--     the closed list of slots gets jira.label.tags / .focus / .category and github.label.tags / .focus / .category, which are OFF by default: a row is kept
--     only when one is switched ON (enabled = true); for every other slot a row is kept only when it differs from "on" as before. Same permission rules
--     (a human workspace admin; never Claude (MCP), a service account or platform staff).
-- No other open branch replaces this function (checked against the remote branches on 2026-11-05). No DROP statements, no table change.

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
  v_default_off constant text[] := array['jira.label.tags', 'jira.label.focus', 'jira.label.category', 'github.label.tags', 'github.label.focus', 'github.label.category'];
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
    when 'jira' then array['jira.label.moscow', 'jira.label.rank', 'jira.label.type', 'jira.label.group', 'jira.label.project', 'jira.dueDate', 'jira.body.artifacts', 'jira.body.files', 'jira.label.tags', 'jira.label.focus', 'jira.label.category']
    else array['github.label.moscow', 'github.label.rank', 'github.label.type', 'github.label.group', 'github.label.project', 'github.milestone', 'github.issueType', 'github.body.artifacts', 'github.body.files', 'github.label.tags', 'github.label.focus', 'github.label.category']
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
