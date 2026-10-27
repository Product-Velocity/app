-- 0043: Claude connections and trust (docs/20-CLAUDE-MCP.md FR-1, FR-8; issue #180, MCP slice 2).
--   * tenants.claude_enabled: the workspace switch, OFF for every workspace until an admin turns it on
--   * mcp_connections: one row per (person, OAuth client), bound to ONE workspace chosen at consent
--   * ai_usage: calls, items written and bytes uploaded per connection and day (rate limits)
--   * audit_log.connection_id: filled by the database from the token, never by a client
-- No forward references to later slices. Forward-only.

-- ---------------------------------------------------------------------------
-- Workspace switch
-- ---------------------------------------------------------------------------
alter table public.tenants add column claude_enabled boolean not null default false;
grant update (claude_enabled) on public.tenants to authenticated;

-- The OAuth-issued token carries a signed client_id claim (migration 0040); the app's own sessions never do.
create function public.is_claude_token() returns boolean
language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '') is not null
$$;

-- Claude cannot switch itself on, and (below) cannot connect, revoke or edit connections.
create function public.guard_claude_switch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.claude_enabled is distinct from old.claude_enabled and public.write_source() = 'Claude MCP' then
    raise exception 'Claude cannot change the Claude switch of a workspace';
  end if;
  return new;
end $$;
create trigger tenants_guard_claude_switch before update on public.tenants
  for each row execute function public.guard_claude_switch();

-- ---------------------------------------------------------------------------
-- mcp_connections
-- ---------------------------------------------------------------------------
create table public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 200),
  client_name text not null check (char_length(btrim(client_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  call_count integer not null default 0 check (call_count >= 0),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
-- one live connection per person and client; approving again for another workspace replaces it
create unique index mcp_connections_one_live
  on public.mcp_connections (user_id, client_id) where revoked_at is null;
create index mcp_connections_tenant_idx on public.mcp_connections (tenant_id, created_at desc);

-- connection create and revoke are audited; the per-call counters are not (they would flood the log)
create trigger mcp_connections_audit after insert or update of revoked_at, revoked_by on public.mcp_connections
  for each row execute function public.audit_row();

alter table public.mcp_connections enable row level security;
-- own connections, plus every connection of a workspace the reader administers (names and counts only: there is no content here)
create policy mcp_connections_select on public.mcp_connections for select to authenticated
  using (
    tenant_id = any (array (select public.my_tenant_ids()))
    and (user_id = auth.uid() or tenant_id = any (array (select public.my_admin_tenant_ids())))
  );
-- no insert/update/delete policy: only the functions below write
revoke all on public.mcp_connections from public, anon, authenticated;
grant select on public.mcp_connections to authenticated;

-- ---------------------------------------------------------------------------
-- ai_usage: metering counters by connection and day (workspace totals are sums over tenant_id + day)
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  connection_id uuid not null references public.mcp_connections (id) on delete cascade,
  day date not null,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  calls integer not null default 0 check (calls >= 0),
  items_written integer not null default 0 check (items_written >= 0),
  bytes_uploaded bigint not null default 0 check (bytes_uploaded >= 0),
  primary key (connection_id, day)
);
create index ai_usage_tenant_day_idx on public.ai_usage (tenant_id, day);

alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;

-- ---------------------------------------------------------------------------
-- Audit: record which connection made a Claude write. Derived from the token, so it cannot be forged.
-- ---------------------------------------------------------------------------
create function public.mcp_current_connection() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.mcp_connections c
   where c.user_id = auth.uid()
     and c.revoked_at is null
     and c.client_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
$$;

alter table public.audit_log add column connection_id uuid;

create function public.audit_log_set_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.connection_id := case when new.via = 'Claude MCP' then public.mcp_current_connection() else null end;
  return new;
end $$;
create trigger audit_log_connection before insert on public.audit_log
  for each row execute function public.audit_log_set_connection();

-- ---------------------------------------------------------------------------
-- Functions the app calls. All security definer, all refuse a Claude token for management actions.
-- ---------------------------------------------------------------------------
-- Daily limits (PRD open question 5). Source of truth; the app reads them back in the result.
create function public.mcp_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'workspace_items_per_day', 200,
    'workspace_bytes_per_day', 100 * 1024 * 1024,
    'workspace_calls_per_day', 10000,
    'connection_calls_per_day', 2000
  )
$$;

-- Approving on the consent screen: binds the person's client to the chosen workspace.
create function public.mcp_connect(p_tenant uuid, p_client_id text, p_client_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.is_claude_token() then raise exception 'Claude cannot manage its own connections' using errcode = '42501'; end if;
  if not public.is_tenant_member(p_tenant) then raise exception 'not a member of this workspace' using errcode = '42501'; end if;
  if not (select claude_enabled from public.tenants where id = p_tenant) then
    raise exception 'claude_disabled' using errcode = 'P0001';
  end if;
  update public.mcp_connections set revoked_at = now(), revoked_by = auth.uid()
   where user_id = auth.uid() and client_id = p_client_id and revoked_at is null;
  insert into public.mcp_connections (tenant_id, user_id, client_id, client_name)
  values (p_tenant, auth.uid(), p_client_id, btrim(p_client_name))
  returning id into v_id;
  return v_id;
end $$;

-- The owner revokes their own connection; a workspace admin may revoke any connection of the workspace.
create function public.mcp_revoke(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_row public.mcp_connections;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.is_claude_token() then raise exception 'Claude cannot manage its own connections' using errcode = '42501'; end if;
  select * into v_row from public.mcp_connections where id = p_id and revoked_at is null;
  if not found then return false; end if;
  if v_row.user_id <> auth.uid() and not public.is_tenant_admin(v_row.tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.mcp_connections set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  return true;
end $$;

-- Called by /mcp on every request with the caller's own token. Says whether this token may be used and as which role.
-- status: ok | no_connection | revoked | workspace_off | not_member
create function public.mcp_authorize() returns table (
  status text, connection_id uuid, tenant_id uuid, tenant_name text, role text, client_name text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  c public.mcp_connections;
  v_role text;
  v_name text;
  v_on boolean;
begin
  if auth.uid() is null or v_client is null then
    return query select 'no_connection'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  select * into c from public.mcp_connections m
   where m.user_id = auth.uid() and m.client_id = v_client
   order by (m.revoked_at is null) desc, m.created_at desc limit 1;
  if not found then
    return query select 'no_connection'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  if c.revoked_at is not null then
    return query select 'revoked'::text, c.id, c.tenant_id, null::text, null::text, c.client_name;
    return;
  end if;
  select t.name, t.claude_enabled into v_name, v_on from public.tenants t where t.id = c.tenant_id;
  select m.role into v_role from public.tenant_members m where m.tenant_id = c.tenant_id and m.user_id = auth.uid();
  if v_role is null then
    return query select 'not_member'::text, c.id, c.tenant_id, v_name, null::text, c.client_name;
  elsif not v_on then
    return query select 'workspace_off'::text, c.id, c.tenant_id, v_name, v_role, c.client_name;
  else
    return query select 'ok'::text, c.id, c.tenant_id, v_name, v_role, c.client_name;
  end if;
end $$;

-- Meters one call. Refuses (and records nothing) when it would pass a daily limit.
-- Only the connection's own OAuth token may call it, so a browser session cannot burn a workspace's quota.
-- Returns {ok: true} or {ok: false, reason, limit, used}.
create function public.mcp_record_call(p_connection uuid, p_items integer default 0, p_bytes bigint default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  c public.mcp_connections;
  lim jsonb := public.mcp_limits();
  v_day date := (now() at time zone 'utc')::date;
  w record;
  u record;
begin
  if p_items < 0 or p_bytes < 0 then raise exception 'negative usage'; end if;
  select * into c from public.mcp_connections
   where id = p_connection and user_id = auth.uid() and client_id = v_client and revoked_at is null;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;

  select coalesce(sum(calls), 0) as calls, coalesce(sum(items_written), 0) as items, coalesce(sum(bytes_uploaded), 0) as bytes
    into w from public.ai_usage where tenant_id = c.tenant_id and day = v_day;
  select coalesce(sum(calls), 0) as calls into u from public.ai_usage where connection_id = c.id and day = v_day;

  if u.calls + 1 > (lim ->> 'connection_calls_per_day')::int then
    return jsonb_build_object('ok', false, 'reason', 'connection_calls', 'limit', lim -> 'connection_calls_per_day', 'used', u.calls);
  elsif w.calls + 1 > (lim ->> 'workspace_calls_per_day')::int then
    return jsonb_build_object('ok', false, 'reason', 'workspace_calls', 'limit', lim -> 'workspace_calls_per_day', 'used', w.calls);
  elsif w.items + p_items > (lim ->> 'workspace_items_per_day')::int then
    return jsonb_build_object('ok', false, 'reason', 'workspace_items', 'limit', lim -> 'workspace_items_per_day', 'used', w.items);
  elsif w.bytes + p_bytes > (lim ->> 'workspace_bytes_per_day')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'workspace_bytes', 'limit', lim -> 'workspace_bytes_per_day', 'used', w.bytes);
  end if;

  insert into public.ai_usage as a (connection_id, day, tenant_id, calls, items_written, bytes_uploaded)
  values (c.id, v_day, c.tenant_id, 1, p_items, p_bytes)
  on conflict (connection_id, day) do update
    set calls = a.calls + 1, items_written = a.items_written + p_items, bytes_uploaded = a.bytes_uploaded + p_bytes;
  update public.mcp_connections set last_used_at = now(), call_count = call_count + 1 where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function
  public.is_claude_token(), public.guard_claude_switch(), public.mcp_current_connection(),
  public.audit_log_set_connection(), public.mcp_limits(),
  public.mcp_connect(uuid, text, text), public.mcp_revoke(uuid), public.mcp_authorize(),
  public.mcp_record_call(uuid, integer, bigint)
  from public, anon, authenticated;
grant execute on function
  public.mcp_limits(), public.mcp_connect(uuid, text, text), public.mcp_revoke(uuid),
  public.mcp_authorize(), public.mcp_record_call(uuid, integer, bigint)
  to authenticated;
