-- Stealth mode (issue #411, decision 2026-11-11-stealth-names): the names of the labels, markers and branding that Product Velocity writes to GitHub and
-- Jira can be changed per project, so nothing in the tracker has to say "Product Velocity" or "pv".
-- Table change: public.tracker_field_config gets label_text (nullable): the custom text of a label prefix (e.g. 'moscow/'), of the base, removed or define
--   label, of the Jira marker prefix or of the GitHub marker word. Null = the default name. Same RLS, audit and grants as before (new column only).
-- Functions replaced by this migration (same signature, so the grants stay):
--   public.tracker_set_field_config(uuid, jsonb)  (last replaced by 20261105163916_value_label_default_on_theme_is_focus.sql): the closed list of slots
--     gets jira.label.base, jira.name.removed, jira.name.define, jira.name.marker and github.label.base, github.name.removed, github.name.define,
--     github.name.block, github.hideBrand (OFF by default); a row may carry "text", checked per slot; a row is kept when it differs from the default
--     (switch, field or text). Same permission rules (a human workspace admin; never Claude (MCP), a service account or platform staff).
-- No other open branch replaces this function (checked against the remote branches on 2026-11-11). No DROP statements.

alter table public.tracker_field_config
  add column label_text text check (label_text is null or label_text ~ '^[A-Za-z0-9:_./-]{1,50}$');

create or replace function public.tracker_set_field_config(p_project uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tracker text;
  r jsonb;
  v_slot text;
  v_enabled boolean;
  v_field text;
  v_text text;
  v_slots text[] := '{}';
  v_allowed text[];
  -- switches that are OFF unless a person turns them on (the optional labels): the default is off, so a row is kept only when one is switched ON
  v_default_off constant text[] := array['jira.label.tags', 'jira.label.focus', 'github.label.tags', 'github.label.focus', 'github.hideBrand'];
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
    when 'jira' then array['jira.label.moscow', 'jira.label.rank', 'jira.label.type', 'jira.label.group', 'jira.label.project', 'jira.dueDate', 'jira.body.artifacts', 'jira.body.files', 'jira.label.tags', 'jira.label.focus', 'jira.label.value', 'jira.label.quarter', 'jira.label.base', 'jira.name.removed', 'jira.name.define', 'jira.name.marker']
    else array['github.label.moscow', 'github.label.rank', 'github.label.type', 'github.label.group', 'github.label.project', 'github.milestone', 'github.issueType', 'github.body.artifacts', 'github.body.files', 'github.label.tags', 'github.label.focus', 'github.label.value', 'github.label.quarter', 'github.label.base', 'github.name.removed', 'github.name.define', 'github.name.block', 'github.hideBrand']
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
    -- the custom name (stealth mode): the shape depends on the slot
    if r ? 'text' and jsonb_typeof(r -> 'text') not in ('string', 'null') then raise exception 'bad text' using errcode = '22023'; end if;
    v_text := case when jsonb_typeof(r -> 'text') = 'string' then nullif(r ->> 'text', '') else null end;
    if v_text is not null then
      if v_slot ~ '^(github|jira)\.label\.(project|moscow|rank|type|group|focus|value|quarter|tags)$' then
        if v_text !~ '^[A-Za-z0-9:_./-]{2,30}$' or right(v_text, 1) <> '/' then raise exception 'The label text for % must end in a slash.', v_slot using errcode = '22023'; end if;
      elsif v_slot ~ '^(github|jira)\.label\.base$' or v_slot ~ '^(github|jira)\.name\.(removed|define)$' then
        if v_text !~ '^[A-Za-z0-9:_./-]{1,50}$' then raise exception 'The label text for % is not valid.', v_slot using errcode = '22023'; end if;
      elsif v_slot = 'jira.name.marker' then
        if v_text !~ '^[A-Za-z0-9:_.-]{1,24}/$' then raise exception 'The marker text for % must end in a slash.', v_slot using errcode = '22023'; end if;
      elsif v_slot = 'github.name.block' then
        if v_text !~ '^[a-z0-9_-]{1,20}$' then raise exception 'The marker word for % is not valid.', v_slot using errcode = '22023'; end if;
      else
        raise exception 'The setting % has no text.', v_slot using errcode = '22023';
      end if;
    end if;
    if v_enabled = not (v_slot = any (v_default_off)) and v_field is null and v_text is null then continue; end if; -- the default: no row
    v_slots := v_slots || v_slot;
    perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
    insert into public.tracker_field_config (tenant_id, project_id, provider, slot, enabled, field_id, label_text)
      values (v_tenant, p_project, v_tracker, v_slot, v_enabled, v_field, v_text)
      on conflict (project_id, slot) do update set enabled = excluded.enabled, field_id = excluded.field_id, label_text = excluded.label_text
        where (public.tracker_field_config.enabled, public.tracker_field_config.field_id, public.tracker_field_config.label_text) is distinct from (excluded.enabled, excluded.field_id, excluded.label_text);
  end loop;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  delete from public.tracker_field_config where project_id = p_project and tenant_id = v_tenant and not (slot = any (v_slots));
end $$;
