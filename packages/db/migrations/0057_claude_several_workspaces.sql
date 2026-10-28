-- 0057: one Claude connection can cover several workspaces (R-114, docs/22 and docs/20 FR-1; decided by Ashu 2026-10-28).
--   * mcp_connections: one live row per (person, client, WORKSPACE) instead of per (person, client); a new last_write_at
--   * tenants.claude_single_only: an admin may forbid multi-workspace connections ("Claude may be used here only on its own")
--   * the workspace of a call is passed explicitly (p_tenant) and held in the transaction-local setting pv.mcp_tenant; without it a
--     connection with exactly one workspace behaves as before, and one with several is refused (never guessed)
--   * audit rows get their connection from the workspace of the row itself, so a write in B can never be stamped with A's connection
--   * mcp_connect_many (consent with several workspaces), mcp_authorize_all (one answer per workspace), mcp_record_call(p_write)
-- Forward-only. No data is touched: every existing connection is one row and stays one row.

alter table public.tenants add column claude_single_only boolean not null default false;
grant update (claude_single_only) on public.tenants to authenticated;

create or replace function public.guard_claude_switch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.claude_enabled is distinct from old.claude_enabled or new.claude_single_only is distinct from old.claude_single_only)
     and public.write_source() = 'Claude MCP' then
    raise exception 'Claude cannot change the Claude settings of a workspace';
  end if;
  return new;
end $$;

drop index public.mcp_connections_one_live;
create unique index mcp_connections_one_live on public.mcp_connections (user_id, client_id, tenant_id) where revoked_at is null;
alter table public.mcp_connections add column last_write_at timestamptz;

-- The live connection row of the caller's token for one workspace, or null.
create function public.mcp_connection_for(p_tenant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.mcp_connections c
   where c.user_id = auth.uid() and c.revoked_at is null and c.tenant_id = p_tenant
     and c.client_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
$$;

-- The connection row the current call is for: the workspace in pv.mcp_tenant when set, else the only live one; null when there are several.
create or replace function public.mcp_current_connection() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := nullif(current_setting('pv.mcp_tenant', true), '')::uuid;
  v_ids uuid[];
begin
  if v_tenant is not null then return public.mcp_connection_for(v_tenant); end if;
  select array_agg(c.id) into v_ids from public.mcp_connections c
   where c.user_id = auth.uid() and c.revoked_at is null
     and c.client_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  return case when coalesce(array_length(v_ids, 1), 0) = 1 then v_ids[1] else null end;
end $$;

create or replace function public.audit_log_set_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.connection_id := case when new.via = 'Claude MCP' then public.mcp_connection_for(new.tenant_id) else null end;
  new.change_set_id := case when new.via = 'Claude MCP' and new.connection_id is not null then
    (select s.id from public.mcp_change_sets s
      where s.id = nullif(current_setting('pv.change_set', true), '')::uuid and s.connection_id = new.connection_id)
    else null end;
  return new;
end $$;

-- Approving on the consent screen with one or more workspaces: replaces every live connection of this person and client.
create function public.mcp_connect_many(p_tenants uuid[], p_client_id text, p_client_name text) returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  t uuid;
  v_tenants uuid[];
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.is_claude_token() then raise exception 'Claude cannot manage its own connections' using errcode = '42501'; end if;
  select array_agg(distinct x) into v_tenants from unnest(p_tenants) x where x is not null;
  if coalesce(array_length(v_tenants, 1), 0) = 0 then raise exception 'choose a workspace' using errcode = 'P0001'; end if;
  foreach t in array v_tenants loop
    if not public.is_tenant_member(t) then raise exception 'not a member of this workspace' using errcode = '42501'; end if;
    if not (select claude_enabled from public.tenants where id = t) then raise exception 'claude_disabled' using errcode = 'P0001'; end if;
    if array_length(v_tenants, 1) > 1 and (select claude_single_only from public.tenants where id = t) then
      raise exception 'single_only' using errcode = 'P0001';
    end if;
  end loop;
  update public.mcp_connections set revoked_at = now(), revoked_by = auth.uid()
   where user_id = auth.uid() and client_id = p_client_id and revoked_at is null;
  foreach t in array v_tenants loop
    insert into public.mcp_connections (tenant_id, user_id, client_id, client_name)
    values (t, auth.uid(), p_client_id, btrim(p_client_name))
    returning id into v_id;
    return next v_id;
  end loop;
end $$;

create or replace function public.mcp_connect(p_tenant uuid, p_client_id text, p_client_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  return (select x from public.mcp_connect_many(array[p_tenant], p_client_id, p_client_name) x limit 1);
end $$;

-- One answer per workspace of the caller's live connection: ok | not_member | workspace_off | single_only.
-- With no live row it answers like mcp_authorize: revoked | no_connection (one row).
create function public.mcp_authorize_all() returns table (
  status text, connection_id uuid, tenant_id uuid, tenant_name text, role text, client_name text, last_write_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  c public.mcp_connections;
  v_role text; v_name text; v_on boolean; v_single boolean;
  v_live int;
begin
  if auth.uid() is null or v_client is null then
    return query select 'no_connection'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  select count(*) into v_live from public.mcp_connections m where m.user_id = auth.uid() and m.client_id = v_client and m.revoked_at is null;
  if v_live = 0 then
    select * into c from public.mcp_connections m where m.user_id = auth.uid() and m.client_id = v_client order by m.created_at desc limit 1;
    if not found then
      return query select 'no_connection'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::timestamptz;
    else
      return query select 'revoked'::text, c.id, c.tenant_id, null::text, null::text, c.client_name, c.last_write_at;
    end if;
    return;
  end if;
  for c in select * from public.mcp_connections m where m.user_id = auth.uid() and m.client_id = v_client and m.revoked_at is null order by m.created_at, m.id loop
    select t.name, t.claude_enabled, t.claude_single_only into v_name, v_on, v_single from public.tenants t where t.id = c.tenant_id;
    select m.role into v_role from public.active_tenant_members m where m.tenant_id = c.tenant_id and m.user_id = auth.uid();
    if v_role is null then
      return query select 'not_member'::text, c.id, c.tenant_id, v_name, null::text, c.client_name, c.last_write_at;
    elsif not v_on then
      return query select 'workspace_off'::text, c.id, c.tenant_id, v_name, v_role, c.client_name, c.last_write_at;
    elsif v_single and v_live > 1 then
      return query select 'single_only'::text, c.id, c.tenant_id, v_name, v_role, c.client_name, c.last_write_at;
    else
      return query select 'ok'::text, c.id, c.tenant_id, v_name, v_role, c.client_name, c.last_write_at;
    end if;
  end loop;
end $$;

-- Meters one call (0043) and, for a writing call, notes when this workspace was last written to.
drop function public.mcp_record_call(uuid, integer, bigint);
create function public.mcp_record_call(p_connection uuid, p_items integer default 0, p_bytes bigint default 0, p_write boolean default false) returns jsonb
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
  update public.mcp_connections set last_used_at = now(), call_count = call_count + 1, last_write_at = case when p_write then now() else last_write_at end where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

-- The three RPCs that start a write transaction take the workspace explicitly.
drop function public.mcp_apply(text, jsonb, boolean, uuid);
drop function public.mcp_undo_last();
drop function public.mcp_pending_save(jsonb, jsonb);

create function public.mcp_apply(p_tool text, p_units jsonb, p_all_or_nothing boolean default false, p_pending uuid default null, p_tenant uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  s jsonb;
  v_tenant uuid;
  v_units jsonb := '[]'::jsonb;
  v_ops jsonb;
  unit jsonb; op jsonb;
  n int := 0;
  v_new uuid; v_code text; v_item uuid; v_rows int;
  v_row jsonb; v_cols text; v_sets text; v_kind text; v_field text; v_val jsonb; v_ret jsonb;
begin
  -- which workspace of the connection this call is for (R-114); empty = the connection's only workspace
  perform set_config('pv.mcp_tenant', coalesce(p_tenant::text, ''), true);
  s := public.mcp_open_change_set(p_tool);
  v_tenant := (s ->> 'tenant_id')::uuid;
  if p_pending is not null then perform public.mcp_pending_claim(p_pending); end if;
  if jsonb_typeof(p_units) is distinct from 'array' then raise exception 'units must be a list' using errcode = 'PV005'; end if;

  for unit in select * from jsonb_array_elements(p_units) loop
    n := n + 1;
    begin
      v_ops := '[]'::jsonb; v_new := null; v_code := null;
      for op in select * from jsonb_array_elements(coalesce(unit -> 'ops', '[]'::jsonb)) loop
        v_ret := '{}'::jsonb;
        perform set_config('pv.value_type_basis', '', true);
        case op ->> 'op'
          when 'create_item' then
            v_row := (op -> 'row') - 'tenant_id';
            perform public.mcp_value_type_basis(v_row, op ->> 'value_type_basis');
            select string_agg(quote_ident(k), ', '), string_agg('r.' || quote_ident(k), ', ') into v_cols, v_sets
              from jsonb_object_keys(v_row) k;
            if v_cols is null then raise exception 'An initiative needs at least a name.' using errcode = 'PV005'; end if;
            execute format(
              'insert into public.items (tenant_id, %s) select $1, %s from jsonb_populate_record(null::public.items, $2) r returning id, item_code',
              v_cols, v_sets) using v_tenant, v_row into v_new, v_code;
            v_ret := jsonb_build_object('id', v_new, 'code', v_code);
          when 'update_item' then
            v_item := (op ->> 'id')::uuid;
            v_row := op -> 'set';
            perform public.mcp_value_type_basis(v_row, op ->> 'value_type_basis');
            select string_agg(quote_ident(k) || ' = r.' || quote_ident(k), ', ') into v_sets from jsonb_object_keys(v_row) k;
            if v_sets is null then raise exception 'Nothing to change.' using errcode = 'PV005'; end if;
            execute format(
              'update public.items i set %s from jsonb_populate_record(null::public.items, $1) r where i.id = $2 and i.tenant_id = $3 and i.deleted_at is null',
              v_sets) using v_row, v_item, v_tenant;
            get diagnostics v_rows = row_count;
            if v_rows = 0 then raise exception 'That initiative does not exist or you cannot change it.' using errcode = 'PV005'; end if;
            v_ret := jsonb_build_object('id', v_item);
          when 'list_add', 'list_remove' then
            v_item := case when op ->> 'item' = '$new' then v_new else (op ->> 'item')::uuid end;
            if v_item is null then raise exception 'That initiative was not created.' using errcode = 'PV005'; end if;
            v_field := op ->> 'field';
            v_val := op -> 'value';
            if not exists (select 1 from public.items i where i.id = v_item and i.tenant_id = v_tenant and i.deleted_at is null) then
              raise exception 'That initiative does not exist or you cannot change it.' using errcode = 'PV005';
            end if;
            v_kind := case v_field when 'tags' then 'tag' when 'target_scope' then 'target_scope' when 'live_scope' then 'live_scope' when 'target_segments' then 'segment' end;
            if v_kind is not null then
              if op ->> 'op' = 'list_add' then
                insert into public.item_tags (tenant_id, item_id, kind, value) values (v_tenant, v_item, v_kind, v_val #>> '{}') on conflict do nothing;
              else
                delete from public.item_tags where tenant_id = v_tenant and item_id = v_item and kind = v_kind and lower(value) = lower(v_val #>> '{}');
              end if;
            elsif v_field = 'contributing_teams' then
              if op ->> 'op' = 'list_add' then
                insert into public.item_teams (tenant_id, item_id, team_id) values (v_tenant, v_item, (v_val #>> '{}')::uuid) on conflict do nothing;
              else
                delete from public.item_teams where tenant_id = v_tenant and item_id = v_item and team_id = (v_val #>> '{}')::uuid;
              end if;
            elsif v_field = 'artifacts' then
              if op ->> 'op' = 'list_add' then
                if exists (select 1 from public.item_links l where l.tenant_id = v_tenant and l.item_id = v_item and l.url = v_val ->> 'url' and l.label = coalesce(v_val ->> 'label', '')) then
                  null; -- already there
                else
                  insert into public.item_links (tenant_id, item_id, label, url) values (v_tenant, v_item, coalesce(v_val ->> 'label', ''), v_val ->> 'url');
                end if;
              else
                delete from public.item_links where tenant_id = v_tenant and item_id = v_item and url = v_val ->> 'url'
                  and (coalesce(v_val ->> 'label', '') = '' or label = v_val ->> 'label');
                get diagnostics v_rows = row_count;
                if v_rows = 0 then raise exception 'That initiative has no such link.' using errcode = 'PV005'; end if;
              end if;
            elsif v_field in ('depends_on', 'related_to') then
              if op ->> 'op' = 'list_add' then
                insert into public.item_relations (tenant_id, item_id, related_item_id, kind) values (v_tenant, v_item, (v_val #>> '{}')::uuid, v_field) on conflict do nothing;
              else
                delete from public.item_relations where tenant_id = v_tenant and item_id = v_item and related_item_id = (v_val #>> '{}')::uuid and kind = v_field;
                get diagnostics v_rows = row_count;
                if v_rows = 0 then raise exception 'There is no such relation to remove.' using errcode = 'PV005'; end if;
              end if;
            else
              raise exception 'That list cannot be changed through Claude.' using errcode = 'PV005';
            end if;
          else
            raise exception 'Unknown operation.' using errcode = 'PV005';
        end case;
        v_ops := v_ops || jsonb_build_array(v_ret);
      end loop;
      v_units := v_units || jsonb_build_array(jsonb_build_object('ok', true, 'ops', v_ops));
    exception when others then
      if p_all_or_nothing then
        raise exception 'Item % could not be written: % Nothing was written.', n, public.mcp_plain_error(sqlstate, sqlerrm) using errcode = 'PV005';
      end if;
      v_units := v_units || jsonb_build_array(jsonb_build_object('ok', false, 'error', public.mcp_plain_error(sqlstate, sqlerrm)));
    end;
  end loop;
  perform set_config('pv.value_type_basis', '', true);
  return jsonb_build_object('change_set', s -> 'id', 'units', v_units);
end $$;

create function public.mcp_undo_last(p_tenant uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections;
  prev public.mcp_change_sets;
  nxt public.mcp_change_sets;
  e record; a record; i record;
  v_reverted int := 0;
  v_skipped text[] := '{}';
  v_set jsonb; v_sets text;
  v_first bigint;
  v_old jsonb;
  v_created uuid[];
  v_labels jsonb := jsonb_build_object('items', 'an initiative', 'item_tags', 'a tag', 'item_links', 'a link', 'item_relations', 'a relation', 'item_teams', 'a team');
begin
  perform set_config('pv.mcp_tenant', coalesce(p_tenant::text, ''), true);
  c := pv_internal.mcp_writer();
  select * into prev from public.mcp_change_sets s
   where s.connection_id = c.id and s.undone_at is null and s.tool <> 'undo_last'
   order by s.created_at desc, s.id desc limit 1 for update;
  if not found then
    return jsonb_build_object('undone', false, 'message', 'There is nothing to undo: no change made through this connection is still in place.');
  end if;
  nxt := pv_internal.mcp_open_set('undo_last');
  select min(l.id) into v_first from public.audit_log l where l.change_set_id = prev.id;

  -- 1. list rows
  for e in
    select l.entity, l.entity_id,
           bool_or(l.field = 'id' and l.old is null) as was_inserted,
           bool_or(l.field = 'id' and l.new is null) as was_deleted
      from public.audit_log l
     where l.change_set_id = prev.id and l.entity in ('item_tags', 'item_links', 'item_relations', 'item_teams')
     group by l.entity, l.entity_id
  loop
    if e.was_inserted then
      execute format('delete from public.%I where id = $1 and tenant_id = $2', e.entity) using e.entity_id, prev.tenant_id;
      v_reverted := v_reverted + 1;
    elsif e.was_deleted then
      select jsonb_object_agg(l.field, l.old) into v_old from public.audit_log l where l.change_set_id = prev.id and l.entity = e.entity and l.entity_id = e.entity_id;
      begin
        if e.entity = 'item_tags' then
          insert into public.item_tags (id, tenant_id, item_id, kind, value) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, v_old ->> 'kind', v_old ->> 'value');
        elsif e.entity = 'item_links' then
          insert into public.item_links (id, tenant_id, item_id, label, url) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, coalesce(v_old ->> 'label', ''), v_old ->> 'url');
        elsif e.entity = 'item_relations' then
          insert into public.item_relations (id, tenant_id, item_id, related_item_id, kind) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, (v_old ->> 'related_item_id')::uuid, v_old ->> 'kind');
        else
          insert into public.item_teams (id, tenant_id, item_id, team_id) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, (v_old ->> 'team_id')::uuid);
        end if;
        v_reverted := v_reverted + 1;
      exception when others then
        v_skipped := array_append(v_skipped, (v_labels ->> e.entity || ' could not be put back')::text);
      end;
    end if;
  end loop;

  -- 2. changed fields of initiatives that existed before the change set
  select coalesce(array_agg(distinct l.entity_id), '{}') into v_created
    from public.audit_log l where l.change_set_id = prev.id and l.entity = 'items' and l.field = 'id' and l.old is null;
  for i in
    select distinct l.entity_id as item_id from public.audit_log l
     where l.change_set_id = prev.id and l.entity = 'items' and not (l.entity_id = any (v_created))
  loop
    v_set := '{}'::jsonb;
    for a in
      select l.field, l.old, l.new from public.audit_log l
       where l.change_set_id = prev.id and l.entity = 'items' and l.entity_id = i.item_id
         and l.field not in ('id', 'tenant_id', 'item_code', 'stack_rank', 'updated_at', 'last_edited_at', 'last_edited_by', 'created_at', 'created_by', 'created_via', 'deleted_at', 'deleted_by')
       order by l.id
    loop
      if (select coalesce(to_jsonb(t) -> a.field, 'null'::jsonb) from public.items t where t.id = i.item_id and t.tenant_id = prev.tenant_id) is not distinct from coalesce(a.new, 'null'::jsonb) then
        v_set := v_set || jsonb_build_object(a.field, a.old);
      else
        v_skipped := array_append(v_skipped, ('a field of an initiative was changed again since, so it was left as it is')::text);
      end if;
    end loop;
    select string_agg(quote_ident(k) || ' = r.' || quote_ident(k), ', ') into v_sets from jsonb_object_keys(v_set) k;
    if v_sets is not null then
      -- putting a Business Value Type back is not a new claim: say so in the audit row
      if v_set ? 'value_type' then perform set_config('pv.value_type_basis', 'undo of an earlier change made through Claude', true); end if;
      execute format('update public.items t set %s from jsonb_populate_record(null::public.items, $1) r where t.id = $2 and t.tenant_id = $3', v_sets)
        using v_set, i.item_id, prev.tenant_id;
      perform set_config('pv.value_type_basis', '', true);
      v_reverted := v_reverted + 1;
    end if;
  end loop;

  -- 3. initiatives created by the change set go to the Trash, unless a person has edited them since
  for i in select u as item_id from unnest(v_created) u loop
    if exists (
      select 1 from public.audit_log l
       where l.entity = 'items' and l.entity_id = i.item_id and l.id > v_first and l.via <> 'Claude MCP' and l.field not in ('last_edited_at', 'last_edited_by')
    ) then
      v_skipped := array_append(v_skipped, 'an initiative was edited by a person since, so it was kept'::text);
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(prev.tenant_id::text || coalesce((select t.cycle_id::text from public.items t where t.id = i.item_id), ''), 0));
    update public.items t set deleted_at = now(), deleted_by = auth.uid() where t.id = i.item_id and t.tenant_id = prev.tenant_id and t.deleted_at is null;
    perform pv_internal.compact_ranks(array[prev.tenant_id], array[(select t.cycle_id from public.items t where t.id = i.item_id)]);
    v_reverted := v_reverted + 1;
  end loop;

  update public.mcp_change_sets set undone_at = now() where id = prev.id;
  return jsonb_build_object('undone', true, 'tool', prev.tool, 'change_set', prev.id, 'at', prev.created_at, 'reverted', v_reverted, 'skipped', to_jsonb(v_skipped));
end $$;

create function public.mcp_pending_save(p_diff jsonb, p_units jsonb, p_tenant uuid default null) returns table (id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections;
begin
  perform set_config('pv.mcp_tenant', coalesce(p_tenant::text, ''), true);
  c := pv_internal.mcp_writer();
  return query
    insert into public.mcp_pending_changes as p (tenant_id, connection_id, user_id, diff, units, expires_at)
    values (c.tenant_id, c.id, auth.uid(), p_diff, p_units, now() + interval '10 minutes')
    returning p.id, p.expires_at;
end $$;

revoke all on function
  public.mcp_connection_for(uuid), public.mcp_connect_many(uuid[], text, text), public.mcp_authorize_all(),
  public.mcp_record_call(uuid, integer, bigint, boolean), public.mcp_apply(text, jsonb, boolean, uuid, uuid),
  public.mcp_undo_last(uuid), public.mcp_pending_save(jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function
  public.mcp_connect_many(uuid[], text, text), public.mcp_authorize_all(), public.mcp_record_call(uuid, integer, bigint, boolean),
  public.mcp_apply(text, jsonb, boolean, uuid, uuid), public.mcp_undo_last(uuid), public.mcp_pending_save(jsonb, jsonb, uuid)
  to authenticated;
