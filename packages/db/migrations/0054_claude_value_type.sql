-- R-112 slice 3: Value Type is the one value field Claude may set (CLAUDE.md rule 3, docs/22 section 6).
-- Only when the person stated it or answered a question about it, with their own words recorded as the basis. Everything else that is
-- commercial (Value, Value Basis, Confidence, Time to First Revenue, Customers Requesting), Stack Rank and Decision stays people-only.
-- How it is enforced: mcp_apply refuses a Value Type without a basis (at least 8 characters) and puts the basis in the transaction-local
-- setting pv.value_type_basis for that one operation; items_guard lets a Claude token change value_type only while it is set; the audit row
-- of the change carries the basis (audit_log.basis). A token that skips mcp_apply has no basis and is refused with PV004, as before.

alter table public.audit_log add column basis text;

create function public.audit_log_basis() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.entity = 'items' and new.field = 'value_type' and coalesce(current_setting('pv.value_type_basis', true), '') <> '' then
    new.basis := left(current_setting('pv.value_type_basis', true), 500);
  end if;
  return new;
end $$;
create trigger audit_log_basis before insert on public.audit_log
  for each row execute function public.audit_log_basis();

-- Checks the basis of one operation and sets it for the statement that follows; a row without value_type resets it.
create function public.mcp_value_type_basis(p_row jsonb, p_basis text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_row ? 'value_type' then
    if length(btrim(coalesce(p_basis, ''))) < 8 then
      raise exception 'Value Type needs the person''s own words as its basis (value_type_basis), at least a short sentence.' using errcode = 'PV005';
    end if;
    perform set_config('pv.value_type_basis', left(btrim(p_basis), 500), true);
  else
    perform set_config('pv.value_type_basis', '', true);
  end if;
end $$;

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
    'value_12m', 'decision', 'decided_by', 'decision_date', 'value_basis',
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
    -- Value Type is the one exception (rule 3): a Claude token may set it only inside mcp_apply, which records the person's own words
    -- in pv.value_type_basis for this statement; service accounts never may
    if (tg_op = 'INSERT' and v_new -> 'value_type' is not null and v_new -> 'value_type' <> 'null'::jsonb)
       or (tg_op = 'UPDATE' and coalesce(v_new -> 'value_type', 'null'::jsonb) is distinct from coalesce(v_old -> 'value_type', 'null'::jsonb)) then
      if not v_claude or coalesce(current_setting('pv.value_type_basis', true), '') = '' then
        raise exception 'Claude can set Value Type only with the person''s own words as the basis' using errcode = 'PV004';
      end if;
    end if;
  end if;
  -- only a person accepts a draft (flips ai_draft off)
  if v_claude and tg_op = 'UPDATE' and new.ai_draft is distinct from old.ai_draft then
    raise exception 'Claude cannot accept or reject an AI draft; a person does' using errcode = 'PV004';
  end if;
  return new;
end $$;

create or replace function public.mcp_apply(p_tool text, p_units jsonb, p_all_or_nothing boolean default false, p_pending uuid default null) returns jsonb
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

create or replace function public.mcp_undo_last() returns jsonb
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
      -- putting a Value Type back is not a new claim: say so in the audit row
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

revoke all on function public.audit_log_basis(), public.mcp_value_type_basis(jsonb, text) from public, anon, authenticated;
grant execute on function public.mcp_value_type_basis(jsonb, text) to authenticated; -- mcp_apply runs as the caller
