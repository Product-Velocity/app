-- Jira, slice B of issue #67 (with #70): a PV project links to one Jira project of one of the workspace's connections, and records which of
-- THAT Jira project's own issue types are the PV Initiative, Epic and Task (issue types differ per project, spike J4).
-- jira_project_links: written only through jira_link_project() / jira_unlink_project() by a human admin (never Claude, never a service
--   account, never platform staff); signed-in members read it. A PV project has at most one link, and a Jira project backs at most one PV
--   project of a workspace. Linking sets projects.tracker = 'jira' (guard PV008 applies: a project that uses GitHub cannot be linked);
--   unlinking releases it. Disconnecting a connection (jira_disconnect, replaced here) removes its links and releases those projects.
-- Functions replaced by this migration: jira_disconnect(uuid) (created in 20261102214958, nobody else changes it). No DROP statements.

create table public.jira_project_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  connection_id uuid not null,
  site_id text not null check (length(site_id) between 1 and 64),
  jira_project_id text not null check (jira_project_id ~ '^[0-9]{1,20}$'),
  jira_project_key text not null check (jira_project_key ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  jira_project_name text not null check (length(jira_project_name) between 1 and 200),
  initiative_type_id text not null check (initiative_type_id ~ '^[0-9]{1,20}$'),
  initiative_type_name text not null check (length(initiative_type_name) between 1 and 100),
  epic_type_id text check (epic_type_id ~ '^[0-9]{1,20}$'),
  epic_type_name text check (length(epic_type_name) between 1 and 100),
  task_type_id text check (task_type_id ~ '^[0-9]{1,20}$'),
  task_type_name text check (length(task_type_name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id),
  unique (project_id),
  unique (tenant_id, connection_id, site_id, jira_project_id),
  check ((epic_type_id is null) = (epic_type_name is null)),
  check ((task_type_id is null) = (task_type_name is null)),
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id) references public.jira_connections (tenant_id, id) on delete cascade
);
create index jira_project_links_tenant_idx on public.jira_project_links (tenant_id, connection_id);

create trigger jira_project_links_meta before insert or update on public.jira_project_links
  for each row execute function public.set_write_meta();
create trigger jira_project_links_audit after insert or update or delete on public.jira_project_links
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_project_links
  for each row execute function platform.readonly_guard();

alter table public.jira_project_links enable row level security;
create policy jira_project_links_select on public.jira_project_links for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_project_links from public, anon, authenticated;
grant select on public.jira_project_links to authenticated;
grant all on public.jira_project_links to service_role;

create function public.jira_link_project(
  p_project uuid, p_connection uuid, p_site text,
  p_jira_project_id text, p_jira_project_key text, p_jira_project_name text,
  p_initiative_id text, p_initiative_name text,
  p_epic_id text default null, p_epic_name text default null,
  p_task_id text default null, p_task_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tracker text;
  v_id uuid;
begin
  select tenant_id, tracker into v_tenant, v_tracker from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can link a project to Jira.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.jira_connections c, jsonb_array_elements(c.sites) s
     where c.id = p_connection and c.tenant_id = v_tenant and c.state = 'connected' and s ->> 'id' = p_site
  ) then
    raise exception 'That Jira connection is not available for this workspace.' using errcode = 'PV009';
  end if;
  if v_tracker is not null and v_tracker <> 'jira' then
    raise exception 'This project uses % as its tracker. Remove its % links first.', initcap(v_tracker), initcap(v_tracker) using errcode = 'PV008';
  end if;
  insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name,
      initiative_type_id, initiative_type_name, epic_type_id, epic_type_name, task_type_id, task_type_name)
    values (v_tenant, p_project, p_connection, p_site, p_jira_project_id, p_jira_project_key, p_jira_project_name,
      p_initiative_id, p_initiative_name, p_epic_id, p_epic_name, p_task_id, p_task_name)
    on conflict (project_id) do update set connection_id = excluded.connection_id, site_id = excluded.site_id,
      jira_project_id = excluded.jira_project_id, jira_project_key = excluded.jira_project_key, jira_project_name = excluded.jira_project_name,
      initiative_type_id = excluded.initiative_type_id, initiative_type_name = excluded.initiative_type_name,
      epic_type_id = excluded.epic_type_id, epic_type_name = excluded.epic_type_name,
      task_type_id = excluded.task_type_id, task_type_name = excluded.task_type_name
    returning id into v_id;
  update public.projects set tracker = 'jira' where id = p_project and tracker is distinct from 'jira';
  return v_id;
end $$;
revoke all on function public.jira_link_project(uuid, uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.jira_link_project(uuid, uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;

create function public.jira_unlink_project(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can unlink a project from Jira.' using errcode = '42501';
  end if;
  delete from public.jira_project_links where project_id = p_project;
  update public.projects set tracker = null where id = p_project and tracker = 'jira';
end $$;
revoke all on function public.jira_unlink_project(uuid) from public, anon;
grant execute on function public.jira_unlink_project(uuid) to authenticated;

-- Ends a connection: the tokens are deleted at once, and the projects linked through it are released.
create or replace function public.jira_disconnect(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.jira_connections where id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can disconnect Jira.' using errcode = '42501';
  end if;
  delete from public.jira_credentials where connection_id = p_connection;
  update public.projects set tracker = null
   where tracker = 'jira' and id in (select project_id from public.jira_project_links where connection_id = p_connection);
  delete from public.jira_project_links where connection_id = p_connection;
  update public.jira_connections set state = 'disconnected' where id = p_connection and state <> 'disconnected';
end $$;
