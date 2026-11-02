-- Jira connection, slice A of issue #67 (docs/16-ATLASSIAN.md, decisions/2026-11-02-jira-connection.md).
-- jira_connections: one row per Atlassian sign-in (an OAuth 2.0 grant) of a workspace; the Jira sites it reaches are listed
--   in `sites`. A project later links to one connection and one Jira project (slice B). Only the server (the OAuth return
--   route) creates or changes a connection; signed-in people read it, and a human admin ends it through jira_disconnect().
-- jira_credentials: the ENCRYPTED access and refresh tokens (AES-256-GCM in the app, key in an environment variable).
--   No policy and no grant for signed-in users: only the service role reads it. It has NO audit trigger on purpose, so a
--   token (even encrypted) never reaches the audit log.
-- Atlassian's refresh token rotates (spike J4), so a refresh must run once per connection at a time: jira_refresh_claim()
--   hands out a short lease; the holder stores the new tokens and clears it.
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sites jsonb not null default '[]'::jsonb check (jsonb_typeof(sites) = 'array'),
  scopes text not null default '',
  state text not null default 'connected' check (state in ('connected', 'reconnect_needed', 'disconnected')),
  connected_by uuid references auth.users (id) on delete set null,
  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id)
);
create index jira_connections_tenant_idx on public.jira_connections (tenant_id, state);

create function public.jira_connections_state_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then new.state_changed_at := now(); end if;
  return new;
end $$;
create trigger jira_connections_stamp before update on public.jira_connections
  for each row execute function public.jira_connections_state_stamp();
create trigger jira_connections_meta before insert or update on public.jira_connections
  for each row execute function public.set_write_meta();
create trigger jira_connections_audit after insert or update or delete on public.jira_connections
  for each row execute function public.audit_row();

create table public.jira_credentials (
  connection_id uuid primary key,
  tenant_id uuid not null,
  access_token_enc text not null,
  refresh_token_enc text,
  key_id text not null,
  access_expires_at timestamptz not null,
  refresh_lease_until timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.jira_connections (tenant_id, id) on delete cascade
);
create index jira_credentials_tenant_idx on public.jira_credentials (tenant_id, connection_id);

-- platform staff read, never write, customer data (rule 10): the read-only guard goes on every table that carries a tenant
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_connections
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_credentials
  for each row execute function platform.readonly_guard();

revoke all on function public.jira_connections_state_stamp() from public, anon, authenticated;

alter table public.jira_connections enable row level security;
alter table public.jira_credentials enable row level security;
create policy jira_connections_select on public.jira_connections for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));

revoke all on public.jira_connections, public.jira_credentials from public, anon, authenticated;
grant select on public.jira_connections to authenticated;
grant all on public.jira_connections, public.jira_credentials to service_role;

-- One refresh at a time per connection. True means the caller holds the lease (30 s by default) and must refresh,
-- store the new tokens (which clears the lease) or let it expire; false means someone else is refreshing.
create function public.jira_refresh_claim(p_connection uuid, p_seconds integer default 30) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  update public.jira_credentials
     set refresh_lease_until = now() + make_interval(secs => greatest(5, least(p_seconds, 120)))
   where connection_id = p_connection and (refresh_lease_until is null or refresh_lease_until < now());
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;
revoke all on function public.jira_refresh_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.jira_refresh_claim(uuid, integer) to service_role;

-- Ends a connection: the tokens are deleted at once. (Projects linked to it are released in slice B.)
create function public.jira_disconnect(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.jira_connections where id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can disconnect Jira.' using errcode = '42501';
  end if;
  delete from public.jira_credentials where connection_id = p_connection;
  update public.jira_connections set state = 'disconnected' where id = p_connection and state <> 'disconnected';
end $$;
revoke all on function public.jira_disconnect(uuid) from public, anon;
grant execute on function public.jira_disconnect(uuid) to authenticated;
