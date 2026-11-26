-- Issue #693: Confluence gets its OWN connection, separate from Jira's (Ashu, 2026-11-26: "separate the Jira and Confluence connect and disconnect").
-- Until now Confluence permission was added to the Jira sign-in, so changing it meant touching the Jira connection and its project links. Now:
--   confluence_connections: one row per Atlassian sign-in made for Confluence only (the sites it reaches are in `sites`). At most ONE live connection per workspace.
--   confluence_credentials: the ENCRYPTED tokens, the same design as jira_credentials: no policy and no grant for signed-in users, no audit trigger (a token,
--     even encrypted, never reaches the audit log), a refresh lease because Atlassian's refresh token rotates.
-- Only the server (the OAuth return route) creates or changes a connection; signed-in people read it; a human admin ends it with confluence_disconnect().
-- Jira's connection, project links and settings are not touched by any of this, so connecting, reconnecting or disconnecting Confluence never affects Jira.
-- item_document_pages.connection_id now points at confluence_connections (it pointed at jira_connections, which was only ever used for the first publishes).
--   The new constraint is NOT VALID on purpose: rows written before this migration are left as they are and are never checked again unless that column changes.
-- Functions replaced: none. No data is touched.
-- ADDITIVE except the constraint swap above. Apply BEFORE deploying the app version that reads these tables. Rollback: forward-only.

create table public.confluence_connections (
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
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id)
);
create index confluence_connections_tenant_idx on public.confluence_connections (tenant_id, state);
create unique index confluence_connections_live_key on public.confluence_connections (tenant_id) where state <> 'disconnected';

create function public.confluence_connections_state_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then new.state_changed_at := now(); end if;
  return new;
end $$;
create trigger confluence_connections_stamp before update on public.confluence_connections
  for each row execute function public.confluence_connections_state_stamp();
create trigger confluence_connections_meta before insert or update on public.confluence_connections
  for each row execute function public.set_write_meta();
create trigger confluence_connections_audit after insert or update or delete on public.confluence_connections
  for each row execute function public.audit_row();

create table public.confluence_credentials (
  connection_id uuid primary key,
  tenant_id uuid not null,
  access_token_enc text not null,
  refresh_token_enc text,
  key_id text not null,
  access_expires_at timestamptz not null,
  refresh_lease_until timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.confluence_connections (tenant_id, id) on delete cascade
);
create index confluence_credentials_tenant_idx on public.confluence_credentials (tenant_id, connection_id);

-- platform staff read, never write, customer data (rule 10); a paused account refuses writes
create trigger a_platform_readonly_guard before insert or update or delete on public.confluence_connections
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.confluence_credentials
  for each row execute function platform.readonly_guard();
create trigger b_platform_suspended_guard before insert or update or delete on public.confluence_connections
  for each row execute function platform.suspended_guard();
create trigger b_platform_suspended_guard before insert or update or delete on public.confluence_credentials
  for each row execute function platform.suspended_guard();

revoke all on function public.confluence_connections_state_stamp() from public, anon, authenticated;

alter table public.confluence_connections enable row level security;
alter table public.confluence_credentials enable row level security;
create policy confluence_connections_select on public.confluence_connections for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));

revoke all on public.confluence_connections, public.confluence_credentials from public, anon, authenticated;
grant select on public.confluence_connections to authenticated;
grant all on public.confluence_connections, public.confluence_credentials to service_role;

-- One refresh at a time per connection (Atlassian's refresh token rotates). True means the caller holds the lease and must refresh.
create function public.confluence_refresh_claim(p_connection uuid, p_seconds integer default 30) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  update public.confluence_credentials
     set refresh_lease_until = now() + make_interval(secs => greatest(5, least(p_seconds, 120)))
   where connection_id = p_connection and (refresh_lease_until is null or refresh_lease_until < now());
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;
revoke all on function public.confluence_refresh_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.confluence_refresh_claim(uuid, integer) to service_role;

-- Ends the Confluence connection: the tokens are deleted at once. Documents already published keep their records and their pages; publishing and
-- reading pages stop until a workspace admin connects Confluence again. Jira is not touched.
create function public.confluence_disconnect(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.confluence_connections where id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can disconnect Confluence.' using errcode = '42501';
  end if;
  delete from public.confluence_credentials where connection_id = p_connection;
  update public.confluence_connections set state = 'disconnected' where id = p_connection and state <> 'disconnected';
end $$;
revoke all on function public.confluence_disconnect(uuid) from public, anon;
grant execute on function public.confluence_disconnect(uuid) to authenticated;

-- publications point at the Confluence connection now
alter table public.item_document_pages drop constraint if exists item_document_pages_connection_id_fkey;
alter table public.item_document_pages add constraint item_document_pages_confluence_connection_fkey
  foreign key (connection_id) references public.confluence_connections (id) on delete set null not valid;
