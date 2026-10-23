-- 0018: connect a workspace to GitHub (issue #31).
-- github_connections: one open connection per workspace. An admin starts it (state 'requested'); only the GitHub
--   webhook and the install-return route move it to 'connected', through the service role. The app never claims
--   to be connected before GitHub's installation webhook arrives. Signed-in users cannot update rows at all:
--   they disconnect through github_disconnect().
-- github_repositories: the repositories an installation can reach (written by the server only).
-- projects.default_repo may only be set to an active repository of the workspace's connection.
-- Only human admins (not service accounts, not Claude) can start or end a connection.
-- No DROP statements: applied to Supabase through a tool that pauses on them.

create function public.my_human_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members
  where user_id = auth.uid() and role = 'admin' and not is_service_account
$$;
revoke all on function public.my_human_admin_tenant_ids() from public, anon;
grant execute on function public.my_human_admin_tenant_ids() to authenticated;

create table public.github_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expected_account text not null check (expected_account ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,38})$'),
  installation_id bigint,
  account_login text,
  account_type text check (account_type in ('Organization', 'User')),
  repository_selection text check (repository_selection in ('all', 'selected')),
  state text not null default 'requested'
    check (state in ('requested', 'waiting_approval', 'installing', 'connected', 'suspended', 'disconnected')),
  epic_type_available boolean,
  repositories_synced_at timestamptz,
  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id),
  check (state in ('requested', 'waiting_approval', 'disconnected') or installation_id is not null)
);
-- one open connection per workspace, and one workspace per installation
create unique index github_connections_one_open on public.github_connections (tenant_id) where state <> 'disconnected';
create unique index github_connections_installation on public.github_connections (installation_id)
  where installation_id is not null and state <> 'disconnected';

create function public.github_connections_state_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then new.state_changed_at := now(); end if;
  return new;
end $$;
create trigger github_connections_stamp before update on public.github_connections
  for each row execute function public.github_connections_state_stamp();
create trigger github_connections_meta before insert or update on public.github_connections
  for each row execute function public.set_write_meta();
create trigger github_connections_audit after insert or update or delete on public.github_connections
  for each row execute function public.audit_row();

create table public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  github_repo_id bigint not null,
  full_name text not null check (full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  is_private boolean not null default true,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id) on delete cascade,
  unique (connection_id, github_repo_id)
);
create index github_repositories_tenant_idx on public.github_repositories (tenant_id, connection_id);
create trigger github_repositories_meta before insert or update on public.github_repositories
  for each row execute function public.set_write_meta();
create trigger github_repositories_audit after insert or update or delete on public.github_repositories
  for each row execute function public.audit_row();

-- A project's default repository must be an active repository of its workspace's connection (or empty).
create function public.projects_default_repo_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.default_repo is not null and (tg_op = 'INSERT' or new.default_repo is distinct from old.default_repo) then
    if not exists (
      select 1 from public.github_repositories r
      where r.tenant_id = new.tenant_id and r.removed_at is null and lower(r.full_name) = lower(new.default_repo)
    ) then
      raise exception 'default repository % is not available through this workspace''s GitHub connection', new.default_repo
        using errcode = 'PV005';
    end if;
  end if;
  return new;
end $$;
create trigger projects_default_repo_guard before insert or update of default_repo on public.projects
  for each row execute function public.projects_default_repo_guard();

revoke all on function public.github_connections_state_stamp(), public.projects_default_repo_guard() from public, anon, authenticated;

alter table public.github_connections enable row level security;
alter table public.github_repositories enable row level security;
create policy github_connections_select on public.github_connections for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy github_connections_insert on public.github_connections for insert to authenticated
  with check (tenant_id = any (array (select public.my_human_admin_tenant_ids())) and public.write_source() <> 'Claude MCP');
create policy github_repositories_select on public.github_repositories for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));

revoke all on public.github_connections, public.github_repositories from public, anon, authenticated;
grant select on public.github_connections, public.github_repositories to authenticated;
grant insert (tenant_id, expected_account) on public.github_connections to authenticated;
grant all on public.github_connections, public.github_repositories to service_role;

-- Ends (or cancels) the workspace's connection: repositories are marked removed and project defaults cleared.
create function public.github_disconnect(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can disconnect GitHub.' using errcode = '42501';
  end if;
  update public.github_connections set state = 'disconnected' where tenant_id = p_tenant and state <> 'disconnected';
  update public.github_repositories set removed_at = now() where tenant_id = p_tenant and removed_at is null;
  update public.projects set default_repo = null where tenant_id = p_tenant and default_repo is not null;
end $$;
revoke all on function public.github_disconnect(uuid) from public, anon;
grant execute on function public.github_disconnect(uuid) to authenticated;
