-- Jira Sync sends the description as headed sections (issue #319, decision 2026-11-04-jira-description-sections), like the managed block of a GitHub issue.
-- Functions replaced by this migration (same signatures, so the grants stay; nothing else is changed):
--   public.jira_apply_pull(uuid, uuid, jsonb, jsonb)  (20261103094723_jira_sync_write.sql): "Keep Jira" can now also take over summary and hypothesis
--     (limits 4000 characters each, as for GitHub), besides initiative_name and description. Same permission rules (a creator or admin as a person; never
--     a service account or another workspace).
--   public.tracker_set_field_config(uuid, jsonb)  (20261103233355_tracker_field_config.sql, PR #318): the closed list of Jira slots gets jira.body.artifacts
--     and jira.body.files (the Artifacts and Files sections of the description can be switched off per project).
-- No other open branch replaces either function (checked against the remote branches on 2026-11-04). No DROP statements, no table change.
-- The sync base (item_jira_links.sync_base, hashes only) gets the keys summary, hypothesis and attachments; it is a free-form object, so no change is needed.

create or replace function public.jira_apply_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
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
  if not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can take over text from Jira.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_jira_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push') then
    raise exception 'This item has no Jira issue that can be synced.' using errcode = 'P0002';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'bad fields' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('initiative_name', 'summary', 'description', 'hypothesis') then
      raise exception 'The field % cannot be taken over from Jira.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  if p_fields ? 'initiative_name' and char_length(btrim(p_fields ->> 'initiative_name')) = 0 then
    raise exception 'An initiative needs a name.' using errcode = '22023';
  end if;
  select * into v_old from public.items where id = p_item for update;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set
    initiative_name = case when p_fields ? 'initiative_name' then left(btrim(p_fields ->> 'initiative_name'), 300) else initiative_name end,
    summary = case when p_fields ? 'summary' then nullif(left(p_fields ->> 'summary', 4000), '') else summary end,
    description = case when p_fields ? 'description' then nullif(left(p_fields ->> 'description', 20000), '') else description end,
    hypothesis = case when p_fields ? 'hypothesis' then nullif(left(p_fields ->> 'hypothesis', 4000), '') else hypothesis end
  where id = p_item;
  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k when 'initiative_name' then v_old.initiative_name when 'summary' then v_old.summary when 'hypothesis' then v_old.hypothesis else v_old.description end);
  end loop;
  if p_base is not null then
    update public.item_jira_links l set sync_base = coalesce(l.sync_base, '{}'::jsonb) || p_base, sync_checked_at = now()
     where l.tenant_id = v_tenant and l.item_id = p_item;
  end if;
  return v_changed; -- the values that were replaced, for the undo step
end $$;

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
    when 'jira' then array['jira.label.moscow', 'jira.label.rank', 'jira.label.type', 'jira.label.group', 'jira.label.project', 'jira.dueDate', 'jira.body.artifacts', 'jira.body.files']
    else array['github.label.moscow', 'github.label.rank', 'github.label.type', 'github.label.group', 'github.label.project', 'github.milestone', 'github.issueType', 'github.body.artifacts', 'github.body.files']
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
    if v_enabled and v_field is null then continue; end if; -- the default: no row
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
