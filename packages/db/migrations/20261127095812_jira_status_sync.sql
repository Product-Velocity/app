-- Initiative Status to the Jira workflow status (issue 738, Ashu 2026-11-27; decision 2026-11-27-jira-initiative-status-sync): a per-project option, OFF unless a
-- row exists. One way, Product Velocity to Jira, after the Sync preview and confirmation. Nothing else is stored here: the option is the row, the mapping is
-- `statuses`: {"<Initiative Status>": "<Jira status id>"}. A value that is not in the object leaves Jira alone. Build Status is never part of it (it comes from the epics).
--
-- jira_status_sync: one row per Jira-linked project. Written only by jira_set_status_sync (a human workspace admin; never Claude (MCP), a service account or platform
-- staff), audited by the table's audit trigger. Read by workspace members (the app shows the switch and the mapping to everybody who can see the project).
-- jira_set_status_sync(project, statuses): an empty or null object removes the row (switches the option off). Keys are the five Initiative Status values, values Jira
-- status ids. No function is replaced. No DROP statements.

create table public.jira_status_sync (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  statuses jsonb not null check (jsonb_typeof(statuses) = 'object' and statuses <> '{}'::jsonb),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  unique (project_id),
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade
);
create index jira_status_sync_tenant_idx on public.jira_status_sync (tenant_id, project_id);

create trigger jira_status_sync_meta before insert or update on public.jira_status_sync
  for each row execute function public.set_write_meta();
create trigger jira_status_sync_audit after insert or update or delete on public.jira_status_sync
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_status_sync
  for each row execute function platform.readonly_guard();

alter table public.jira_status_sync enable row level security;
create policy jira_status_sync_select on public.jira_status_sync for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_status_sync from public, anon, authenticated;
grant select on public.jira_status_sync to authenticated;
grant all on public.jira_status_sync to service_role;

create function public.jira_set_status_sync(p_project uuid, p_statuses jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tracker text;
  kv record;
  v_ids text[] := '{}';
begin
  select tenant_id, tracker into v_tenant, v_tracker from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change the field configuration.' using errcode = '42501';
  end if;
  if v_tracker is distinct from 'jira' then raise exception 'That project has no Jira tracker.' using errcode = 'P0002'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  if p_statuses is null or p_statuses = '{}'::jsonb or p_statuses = 'null'::jsonb then
    delete from public.jira_status_sync where project_id = p_project and tenant_id = v_tenant;
    return;
  end if;
  if jsonb_typeof(p_statuses) <> 'object' then raise exception 'bad configuration' using errcode = '22023'; end if;
  for kv in select key, value from jsonb_each(p_statuses) loop
    if kv.key not in ('Backlog', 'Active', 'On hold', 'Completed', 'Cancelled') then
      raise exception 'Initiative Status has no value %.', kv.key using errcode = '22023';
    end if;
    if jsonb_typeof(kv.value) <> 'string' or (kv.value #>> '{}') !~ '^[0-9]{1,12}$' then
      raise exception 'bad Jira status for %', kv.key using errcode = '22023';
    end if;
    v_ids := v_ids || (kv.value #>> '{}');
  end loop;
  insert into public.jira_status_sync (tenant_id, project_id, statuses) values (v_tenant, p_project, p_statuses)
    on conflict (project_id) do update set statuses = excluded.statuses
      where public.jira_status_sync.statuses is distinct from excluded.statuses;
end $$;
revoke all on function public.jira_set_status_sync(uuid, jsonb) from public, anon;
grant execute on function public.jira_set_status_sync(uuid, jsonb) to authenticated;
