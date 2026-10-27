-- 0045: Claude can create and change initiatives (docs/20-CLAUDE-MCP.md FR-4; issue #182, MCP slice 4).
--   * items_guard: a Claude token can no longer set ANY of the fields only a person sets (Decision and its trail, Value and the
--     commercial fields around it), nor change ai_draft; until now only Value, Decision and Stack Rank were refused
--   * items_e_ai_draft: every initiative a Claude token creates is an AI draft, set by the database from the token
--   * mcp_change_sets: one row per tool call that writes, so "undo the last change" knows which audit rows belong together
--   * audit_log.change_set_id: filled by the database from the connection's open change set, never by a client
--   * mcp_pending_changes: a diff held for confirmation (valid for 10 minutes)
--   * functions the /mcp server calls with the caller's own token: mcp_apply (security invoker: row-level security and column
--     grants decide, exactly as for a person), mcp_undo_last, mcp_pending_save, mcp_pending_claim
-- No service role is used anywhere on this path. Forward-only.

-- ---------------------------------------------------------------------------
-- Guard: the fields only a person sets
-- ---------------------------------------------------------------------------
create or replace function public.items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_blocked boolean;
  v_claude boolean := public.write_source() = 'Claude MCP';
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  c text;
  -- the columns behind Decision, Value and the commercial fields (CLAUDE.md rule 3; CLAUDE_FORBIDDEN_FIELDS in packages/domain)
  v_person_only text[] := array[
    'value_12m', 'decision', 'decided_by', 'decision_date', 'value_type', 'value_basis',
    'confidence', 'time_to_first_revenue_months', 'customers_requesting'
  ];
begin
  v_blocked := v_claude
    or exists (
      select 1 from public.tenant_members m
       where m.tenant_id = new.tenant_id and m.user_id = auth.uid() and m.is_service_account
    );
  if v_blocked then
    foreach c in array v_person_only loop
      if tg_op = 'INSERT' then
        if v_new -> c is not null and v_new -> c <> 'null'::jsonb then
          raise exception 'Claude and service accounts cannot set Value or Decision' using errcode = 'PV004';
        end if;
      elsif coalesce(v_new -> c, 'null'::jsonb) is distinct from coalesce(v_old -> c, 'null'::jsonb) then
        raise exception 'Claude and service accounts cannot set Stack Rank, Value or Decision' using errcode = 'PV004';
      end if;
    end loop;
    if tg_op = 'UPDATE'
       and new.stack_rank is distinct from old.stack_rank
       and coalesce(current_setting('pv.rank_internal', true), '') <> 'on' then
      raise exception 'Claude and service accounts cannot set Stack Rank, Value or Decision' using errcode = 'PV004';
    end if;
  end if;
  -- only a person accepts a draft (flips ai_draft off)
  if v_claude and tg_op = 'UPDATE' and new.ai_draft is distinct from old.ai_draft then
    raise exception 'Claude cannot accept or reject an AI draft; a person does' using errcode = 'PV004';
  end if;
  return new;
end $$;

-- Initiatives created through a Claude token are AI drafts, whatever the client sends. Fires after items_d_system (alphabetical order).
create function public.items_ai_draft() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.write_source() = 'Claude MCP' then
    new.ai_draft := true;
  end if;
  return new;
end $$;
create trigger items_e_ai_draft before insert on public.items
  for each row execute function public.items_ai_draft();

-- ---------------------------------------------------------------------------
-- Change sets
-- ---------------------------------------------------------------------------
create table public.mcp_change_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null references public.mcp_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tool text not null check (char_length(tool) between 1 and 80),
  created_at timestamptz not null default clock_timestamp(), -- not now(): two change sets of one transaction must still be ordered
  undone_at timestamptz
);
create index mcp_change_sets_connection_idx on public.mcp_change_sets (connection_id, created_at desc);
create index mcp_change_sets_tenant_idx on public.mcp_change_sets (tenant_id, created_at desc);

alter table public.mcp_change_sets enable row level security;
-- own change sets, plus every one of a workspace the reader administers (tool names and times only; the content is in the audit log)
create policy mcp_change_sets_select on public.mcp_change_sets for select to authenticated
  using (
    tenant_id = any (array (select public.my_tenant_ids()))
    and (user_id = auth.uid() or tenant_id = any (array (select public.my_admin_tenant_ids())))
  );
revoke all on public.mcp_change_sets from public, anon, authenticated;
grant select on public.mcp_change_sets to authenticated;

alter table public.audit_log add column change_set_id uuid;
create index audit_log_change_set_idx on public.audit_log (change_set_id) where change_set_id is not null;

-- The change set is the connection's own: a GUC set inside the writing transaction by mcp_open_change_set, checked against the connection.
create or replace function public.audit_log_set_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.connection_id := case when new.via = 'Claude MCP' then public.mcp_current_connection() else null end;
  new.change_set_id := case when new.via = 'Claude MCP' and new.connection_id is not null then
    (select s.id from public.mcp_change_sets s
      where s.id = nullif(current_setting('pv.change_set', true), '')::uuid and s.connection_id = new.connection_id)
    else null end;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Pending diffs
-- ---------------------------------------------------------------------------
create table public.mcp_pending_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null references public.mcp_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  diff jsonb not null,
  units jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  applied_at timestamptz
);
create index mcp_pending_changes_tenant_idx on public.mcp_pending_changes (tenant_id, created_at desc);

alter table public.mcp_pending_changes enable row level security;
create policy mcp_pending_changes_select on public.mcp_pending_changes for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())) and user_id = auth.uid());
revoke all on public.mcp_pending_changes from public, anon, authenticated;
grant select on public.mcp_pending_changes to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable by clients)
-- ---------------------------------------------------------------------------
-- The caller's live Claude connection and a role that may write; raises otherwise. Returns the connection.
create function pv_internal.mcp_writer() returns public.mcp_connections
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections;
  v_role text;
begin
  if auth.uid() is null or not public.is_claude_token() then
    raise exception 'only a Claude connection can use this' using errcode = '42501';
  end if;
  select * into c from public.mcp_connections where id = public.mcp_current_connection();
  if not found then raise exception 'this connection is not live' using errcode = '42501'; end if;
  select m.role into v_role from public.tenant_members m where m.tenant_id = c.tenant_id and m.user_id = auth.uid();
  if v_role is null or v_role not in ('creator', 'admin') then
    raise exception 'your role in this workspace is read-only' using errcode = '42501';
  end if;
  if not (select claude_enabled from public.tenants where id = c.tenant_id) then
    raise exception 'Claude is switched off for this workspace' using errcode = '42501';
  end if;
  return c;
end $$;

create function pv_internal.mcp_open_set(p_tool text) returns public.mcp_change_sets
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections := pv_internal.mcp_writer();
  s public.mcp_change_sets;
begin
  insert into public.mcp_change_sets (tenant_id, connection_id, user_id, tool)
  values (c.tenant_id, c.id, auth.uid(), left(coalesce(nullif(btrim(p_tool), ''), 'unknown'), 80))
  returning * into s;
  perform set_config('pv.change_set', s.id::text, true);
  return s;
end $$;

-- A message for Claude that never names a table, column or constraint.
create function public.mcp_plain_error(p_state text, p_message text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_state = '42501' then 'You do not have permission to write this.'
    when p_state = '23514' then 'A value is not allowed for its field.'
    when p_state in ('23503', '23502') then 'A person, team, project or initiative named here does not exist in this workspace.'
    when p_state = '23505' then 'That already exists.'
    when p_state in ('PV004', 'PV005') then p_message
    else 'The database refused this change.'
  end
$$;

revoke all on function pv_internal.mcp_writer(), pv_internal.mcp_open_set(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions /mcp calls
-- ---------------------------------------------------------------------------
-- Opens the change set the audit rows of this transaction belong to. mcp_apply calls it (it runs as the caller, who cannot reach pv_internal).
create function public.mcp_open_change_set(p_tool text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.mcp_change_sets := pv_internal.mcp_open_set(p_tool);
begin
  return jsonb_build_object('id', s.id, 'tenant_id', s.tenant_id);
end $$;

-- Holds a diff for confirmation for 10 minutes.
create function public.mcp_pending_save(p_diff jsonb, p_units jsonb) returns table (id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections := pv_internal.mcp_writer();
begin
  return query
    insert into public.mcp_pending_changes as p (tenant_id, connection_id, user_id, diff, units, expires_at)
    values (c.tenant_id, c.id, auth.uid(), p_diff, p_units, now() + interval '10 minutes')
    returning p.id, p.expires_at;
end $$;

-- Takes a diff: once, by the connection that made it, before it expires. Raises PV005 with the reason otherwise.
create function public.mcp_pending_claim(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections := pv_internal.mcp_writer();
  p public.mcp_pending_changes;
begin
  select * into p from public.mcp_pending_changes where id = p_id and connection_id = c.id and tenant_id = c.tenant_id for update;
  if not found then raise exception 'There is no pending change with that id for this connection.' using errcode = 'PV005'; end if;
  if p.applied_at is not null then raise exception 'That change was already confirmed.' using errcode = 'PV005'; end if;
  if p.expires_at <= now() then raise exception 'That change expired after 10 minutes. Run update_items again to get a fresh diff.' using errcode = 'PV005'; end if;
  update public.mcp_pending_changes set applied_at = now() where id = p_id;
end $$;

-- Applies units of writes as the caller. A unit is {"ops": [...]}; ops:
--   {"op":"create_item","row":{column: value}}                      -> {"id","code"}
--   {"op":"update_item","id":uuid,"set":{column: value}}
--   {"op":"list_add"|"list_remove","item":uuid|"$new","field":text,"value":...}
-- Each unit is all or nothing (a subtransaction); a failed unit is reported and the others still go, unless p_all_or_nothing.
-- SECURITY INVOKER on purpose: row-level security and the column grants of `authenticated` decide, as for a person.
create function public.mcp_apply(p_tool text, p_units jsonb, p_all_or_nothing boolean default false, p_pending uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  s jsonb := public.mcp_open_change_set(p_tool);
  v_tenant uuid := (s ->> 'tenant_id')::uuid;
  v_units jsonb := '[]'::jsonb;
  v_ops jsonb;
  unit jsonb; op jsonb;
  n int := 0;
  v_new uuid; v_code text; v_item uuid; v_rows int;
  v_row jsonb; v_cols text; v_sets text; v_kind text; v_field text; v_val jsonb; v_ret jsonb;
begin
  if p_pending is not null then perform public.mcp_pending_claim(p_pending); end if;
  if jsonb_typeof(p_units) is distinct from 'array' then raise exception 'units must be a list' using errcode = 'PV005'; end if;

  for unit in select * from jsonb_array_elements(p_units) loop
    n := n + 1;
    begin
      v_ops := '[]'::jsonb; v_new := null; v_code := null;
      for op in select * from jsonb_array_elements(coalesce(unit -> 'ops', '[]'::jsonb)) loop
        v_ret := '{}'::jsonb;
        case op ->> 'op'
          when 'create_item' then
            v_row := (op -> 'row') - 'tenant_id';
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
  return jsonb_build_object('change_set', s -> 'id', 'units', v_units);
end $$;

-- ---------------------------------------------------------------------------
-- Undo the last change set of this connection, from the audit log
-- ---------------------------------------------------------------------------
-- Reverses, newest first: list rows added or removed, changed fields (only while the field still holds what Claude wrote, so a
-- person's later edit is never overwritten) and created initiatives (moved to the Trash, unless a person edited them since).
-- The reversal is itself audited as source Claude MCP and recorded as its own change set (tool 'undo_last').
create function public.mcp_undo_last() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.mcp_connections := pv_internal.mcp_writer();
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
      execute format('update public.items t set %s from jsonb_populate_record(null::public.items, $1) r where t.id = $2 and t.tenant_id = $3', v_sets)
        using v_set, i.item_id, prev.tenant_id;
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

revoke all on function
  public.mcp_open_change_set(text), public.mcp_pending_save(jsonb, jsonb), public.mcp_pending_claim(uuid),
  public.mcp_apply(text, jsonb, boolean, uuid), public.mcp_undo_last(), public.items_ai_draft(), public.mcp_plain_error(text, text)
  from public, anon, authenticated;
grant execute on function
  public.mcp_open_change_set(text), public.mcp_pending_save(jsonb, jsonb), public.mcp_pending_claim(uuid),
  public.mcp_apply(text, jsonb, boolean, uuid), public.mcp_undo_last(), public.mcp_plain_error(text, text)
  to authenticated;
-- mcp_open_change_set and mcp_pending_claim must be callable because mcp_apply runs as the caller; both check for a live Claude
-- connection with a writing role first, and each touches only that connection's own rows
