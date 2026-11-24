-- Claude daily item limit: default 200 -> 1000, and a per-workspace override that only platform staff can set (issue #667).
--   * tenants.claude_items_per_day: null = the default from mcp_limits(); a number = this workspace's own daily item limit
--   * workspace admins cannot change it (no column grant); staff set it with platform_set_claude_items_limit, which logs it
--   * mcp_record_call (the meter) reads the effective limit for the connection's workspace

alter table public.tenants add column claude_items_per_day integer
  check (claude_items_per_day is null or claude_items_per_day between 1 and 100000);

-- New default. Same signature as 0043, so replacing it is safe.
create or replace function public.mcp_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'workspace_items_per_day', 1000,
    'workspace_bytes_per_day', 100 * 1024 * 1024,
    'workspace_calls_per_day', 10000,
    'connection_calls_per_day', 2000
  )
$$;

-- The limits that apply to one workspace: the defaults, with its item override when staff set one. No access check: internal.
create function platform.tenant_limits(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.mcp_limits() || coalesce(
    (select jsonb_build_object('workspace_items_per_day', t.claude_items_per_day) from public.tenants t where t.id = p_tenant and t.claude_items_per_day is not null),
    '{}'::jsonb)
$$;
revoke all on function platform.tenant_limits(uuid) from public, anon, authenticated;

-- What the Claude settings page shows: a member of the workspace (or platform staff) reads the limits that apply to it.
create function public.mcp_limits_for(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.is_tenant_member(p_tenant) or platform.is_admin(auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return platform.tenant_limits(p_tenant);
end $$;
revoke all on function public.mcp_limits_for(uuid) from public, anon;
grant execute on function public.mcp_limits_for(uuid) to authenticated;

-- The meter: as in 0058, but the item limit is the workspace's own.
create or replace function public.mcp_record_call(p_connection uuid, p_items integer default 0, p_bytes bigint default 0, p_write boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  c public.mcp_connections;
  lim jsonb;
  v_day date := (now() at time zone 'utc')::date;
  w record;
  u record;
begin
  if p_items < 0 or p_bytes < 0 then raise exception 'negative usage'; end if;
  select * into c from public.mcp_connections
   where id = p_connection and user_id = auth.uid() and client_id = v_client and revoked_at is null;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  lim := platform.tenant_limits(c.tenant_id);

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
  update public.mcp_connections set last_used_at = now(), call_count = call_count + 1, last_write_at = case when p_write then now() else last_write_at end where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

-- Platform staff only: the override for one workspace (null = back to the default) and what applies today.
create function public.platform_claude_limit(p_tenant uuid) returns table (override integer, effective integer, used_today integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select t.claude_items_per_day, (platform.tenant_limits(t.id) ->> 'workspace_items_per_day')::int,
           (select coalesce(sum(a.items_written), 0)::int from public.ai_usage a where a.tenant_id = t.id and a.day = (now() at time zone 'utc')::date)
      from public.tenants t where t.id = p_tenant;
end $$;
revoke all on function public.platform_claude_limit(uuid) from public, anon;
grant execute on function public.platform_claude_limit(uuid) to authenticated;

create function public.platform_set_claude_items_limit(p_tenant uuid, p_limit integer, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old integer; v_reason text := left(nullif(btrim(p_reason), ''), 500);
begin
  perform platform.require_admin();
  if p_limit is not null and p_limit not between 1 and 100000 then
    raise exception 'the daily item limit must be between 1 and 100000' using errcode = '22023';
  end if;
  select claude_items_per_day into v_old from public.tenants where id = p_tenant;
  if not found then raise exception 'unknown account' using errcode = 'P0002'; end if;
  if v_old is not distinct from p_limit then return; end if;
  update public.tenants set claude_items_per_day = p_limit where id = p_tenant;
  perform platform.log_config('claude_items_per_day', null, p_tenant, to_jsonb(v_old), to_jsonb(p_limit));
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (p_tenant, 'platform_access', p_tenant, 'claude_items_per_day', to_jsonb(v_old),
          jsonb_build_object('limit', p_limit, 'reason', coalesce(v_reason, 'no reason given')), auth.uid(), 'UI');
end $$;
revoke all on function public.platform_set_claude_items_limit(uuid, integer, text) from public, anon;
grant execute on function public.platform_set_claude_items_limit(uuid, integer, text) to authenticated;
