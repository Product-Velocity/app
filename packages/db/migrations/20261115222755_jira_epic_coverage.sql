-- Epics coverage (issue #464, part of #431): which open Jira epics are linked to initiatives and which are not.
-- jira_epic_projects: the Jira projects a workspace admin ticked under "Projects to check for epics" (per connection and site). Only these are read.
-- jira_epics_seen: the open epics last read from those projects (key, title, status, parent, link). Written ONLY by the service role through
--   jira_replace_epics (one project at a time: rows of that project that are no longer open or listed are removed). Read-only for members.
--   Jira text is data: titles are cut to 300 characters. Nothing here is written to Jira.
-- jira_set_epic_projects(connection, site, keys[]): workspace admins who are people (not service accounts, not platform staff); replaces the ticked set
--   of that connection and site, at most 30 keys; audited.
-- RLS: tenant members read (fast pattern, index starts with tenant_id); nobody signed in writes the tables directly.
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_epic_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  site_id text not null check (length(site_id) between 1 and 64),
  project_key text not null check (project_key ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, connection_id, site_id, project_key)
);
create index jira_epic_projects_tenant on public.jira_epic_projects (tenant_id, connection_id, site_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_epic_projects
  for each row execute function platform.readonly_guard();
create trigger jira_epic_projects_audit after insert or update or delete on public.jira_epic_projects
  for each row execute function public.audit_row();
alter table public.jira_epic_projects enable row level security;
create policy jira_epic_projects_select on public.jira_epic_projects for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_epic_projects from public, anon, authenticated;
grant select on public.jira_epic_projects to authenticated;
grant all on public.jira_epic_projects to service_role;

create table public.jira_epics_seen (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  site_id text not null check (length(site_id) between 1 and 64),
  project_key text not null check (project_key ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  issue_key text not null check (issue_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  title text not null check (char_length(title) <= 300),
  status text check (status is null or char_length(status) <= 100),
  status_category text check (status_category is null or status_category in ('new', 'indeterminate', 'done')),
  parent_key text check (parent_key is null or parent_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  html_url text check (html_url is null or html_url ~ '^https://'),
  jira_updated_at timestamptz,
  read_at timestamptz not null default now(),
  unique (tenant_id, connection_id, site_id, issue_key)
);
create index jira_epics_seen_tenant on public.jira_epics_seen (tenant_id, project_key, issue_key);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_epics_seen
  for each row execute function platform.readonly_guard();
alter table public.jira_epics_seen enable row level security;
create policy jira_epics_seen_select on public.jira_epics_seen for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_epics_seen from public, anon, authenticated;
grant select on public.jira_epics_seen to authenticated;
grant all on public.jira_epics_seen to service_role;

create function public.jira_set_epic_projects(p_connection uuid, p_site text, p_keys text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid := auth.uid();
  k text;
  v_n integer := 0;
begin
  select c.tenant_id into v_tenant from public.jira_connections c where c.id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'Only a workspace admin can choose the projects to check for epics.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = v_actor and m.is_service_account) then
    raise exception 'A service account cannot choose projects.' using errcode = '42501';
  end if;
  if p_keys is null or coalesce(array_length(p_keys, 1), 0) > 30 then raise exception 'Choose up to 30 projects.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  foreach k in array coalesce(p_keys, '{}') loop
    if k is null or k !~ '^[A-Z][A-Z0-9_]{1,19}$' then raise exception '% is not a Jira project key.', left(coalesce(k, ''), 30) using errcode = '22023'; end if;
  end loop;
  delete from public.jira_epic_projects e where e.tenant_id = v_tenant and e.connection_id = p_connection and e.site_id = p_site and e.project_key <> all (coalesce(p_keys, '{}'));
  delete from public.jira_epics_seen s where s.tenant_id = v_tenant and s.connection_id = p_connection and s.site_id = p_site and s.project_key <> all (coalesce(p_keys, '{}'));
  foreach k in array coalesce(p_keys, '{}') loop
    insert into public.jira_epic_projects (tenant_id, connection_id, site_id, project_key, created_by) values (v_tenant, p_connection, p_site, k, v_actor)
      on conflict (tenant_id, connection_id, site_id, project_key) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.jira_set_epic_projects(uuid, text, text[]) from public, anon;
grant execute on function public.jira_set_epic_projects(uuid, text, text[]) to authenticated;

-- service role: replace what was read of one project (rows: key, title, status, category, parent, url, updated)
create function public.jira_replace_epics(p_tenant uuid, p_connection uuid, p_site text, p_project text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
begin
  if p_project !~ '^[A-Z][A-Z0-9_]{1,19}$' or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad input' using errcode = '22023'; end if;
  if not exists (select 1 from public.jira_epic_projects e where e.tenant_id = p_tenant and e.connection_id = p_connection and e.site_id = p_site and e.project_key = p_project) then
    raise exception 'This project is not ticked for epics.' using errcode = '22023';
  end if;
  insert into public.jira_epics_seen (tenant_id, connection_id, site_id, project_key, issue_key, title, status, status_category, parent_key, html_url, jira_updated_at, read_at)
  select p_tenant, p_connection, p_site, p_project, r->>'key', left(coalesce(r->>'title', '(no title)'), 300), left(r->>'status', 100), r->>'category', r->>'parent', r->>'url', nullif(r->>'updated', '')::timestamptz, now()
    from jsonb_array_elements(p_rows) r
   where r->>'key' like p_project || '-%'
  on conflict (tenant_id, connection_id, site_id, issue_key) do update
    set title = excluded.title, status = excluded.status, status_category = excluded.status_category, parent_key = excluded.parent_key,
        html_url = excluded.html_url, jira_updated_at = excluded.jira_updated_at, read_at = now();
  get diagnostics v_n = row_count;
  delete from public.jira_epics_seen s
   where s.tenant_id = p_tenant and s.connection_id = p_connection and s.site_id = p_site and s.project_key = p_project
     and s.issue_key <> all (array (select r->>'key' from jsonb_array_elements(p_rows) r));
  return v_n;
end $$;
revoke all on function public.jira_replace_epics(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.jira_replace_epics(uuid, uuid, text, text, jsonb) to service_role;
