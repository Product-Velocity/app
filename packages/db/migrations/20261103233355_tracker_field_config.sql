-- Tracker field configuration (decision 2026-11-03-tracker-field-config): what a workspace admin changed in the default mapping of Product Velocity
-- fields to GitHub or Jira fields, for ONE project (a project has exactly one delivery tracker, so this is also per connection). A project with no row
-- is at the defaults, which reproduce what Sync did before this table existed.
--
-- tracker_field_config: one row per changed slot (slot ids are a closed list, checked here and by the app: a commercial field has no slot, so it can not
--   be mapped). enabled = false switches the slot off; field_id re-points a "field" slot (today only jira.dueDate: duedate or a custom date field).
--   The start date, theme and priority fields of Jira stay in jira_project_links.field_map (jira_set_field_map) and the GitHub board fields stay in
--   projects.github_board: extended, not replaced.
-- tracker_set_field_config(project, rows): replaces the project's rows with the given list (an empty list = reset to default). A human workspace admin
--   only: never Claude (MCP), a service account or platform staff. Writes only the rows that differ, so the audit trail (audit_row: actor, source,
--   time, old and new value) shows real changes. Nothing is written to GitHub or Jira by it. The app validates the field ids against the tracker's
--   catalog read at save time; the database checks the shapes and the closed slot list.
-- Functions replaced by this migration: none. No DROP statements.

create table public.tracker_field_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  provider text not null check (provider in ('github', 'jira')),
  slot text not null check (slot ~ '^(github|jira)\.[A-Za-z]{1,20}(\.[A-Za-z]{1,20})?$' and split_part(slot, '.', 1) = provider),
  enabled boolean not null default true,
  field_id text check (field_id ~ '^(duedate|customfield_[0-9]{1,9})$'),
  check (enabled or field_id is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  unique (project_id, slot),
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade
);
create index tracker_field_config_tenant_idx on public.tracker_field_config (tenant_id, project_id);

create trigger tracker_field_config_meta before insert or update on public.tracker_field_config
  for each row execute function public.set_write_meta();
create trigger tracker_field_config_audit after insert or update or delete on public.tracker_field_config
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.tracker_field_config
  for each row execute function platform.readonly_guard();

alter table public.tracker_field_config enable row level security;
create policy tracker_field_config_select on public.tracker_field_config for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.tracker_field_config from public, anon, authenticated;
grant select on public.tracker_field_config to authenticated;
grant all on public.tracker_field_config to service_role;

create function public.tracker_set_field_config(p_project uuid, p_rows jsonb) returns void
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
    when 'jira' then array['jira.label.moscow', 'jira.label.rank', 'jira.label.type', 'jira.label.group', 'jira.label.project', 'jira.dueDate']
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
revoke all on function public.tracker_set_field_config(uuid, jsonb) from public, anon;
grant execute on function public.tracker_set_field_config(uuid, jsonb) to authenticated;
