-- 20261102223213_mcp_source_and_ai_name: the write source "Claude MCP" becomes "MCP" for every AI assistant, and every
-- audit entry from an assistant records the AI name and the AI model (issue #289, step 2 of #230; Ashu's go-ahead 2026-11-02).
-- Forward-only.
--
-- 1. Data: every `via` / `created_via` / `saved_via` value 'Claude MCP' becomes 'MCP' (all history was written through Claude, so
--    the AI name of old entries is 'claude'). This rewrites audit history once: the append-only triggers of audit_log are paused
--    inside this migration only, and re-enabled before it ends. No other trigger fires, so no new audit rows or timestamps appear.
-- 2. Rules: every check constraint, policy and function in schemas public and pv_internal that names the literal 'Claude MCP' is re-created with
--    'MCP' (done mechanically from the catalog so no guard is missed: Approver, Stack Rank, Decision, Value, admin and GitHub
--    actions, documents, company profile, undo). A final check fails the migration if one is left.
-- 3. write_source(): a token issued by the OAuth server is 'MCP'; the header x-pv-via 'MCP' (or the old 'Claude MCP') without
--    such a token is still not honoured and is recorded as 'API'.
-- 4. audit_log.ai_tool (claude, chatgpt, gemini, other) comes from the authenticated connection, so it cannot be forged;
--    audit_log.ai_model is what the assistant says it is (header x-pv-ai-model, at most 80 characters, advisory).
-- Replaces audit_log_set_connection() as a whole (last defined in 0058) and write_source() (last defined in 0040).

alter table public.audit_log
  add column ai_tool text check (ai_tool is null or ai_tool in ('claude', 'chatgpt', 'gemini', 'other')),
  add column ai_model text check (ai_model is null or char_length(btrim(ai_model)) between 1 and 80);

do $$
declare
  r record;
  t record;
begin
  -- 1a. drop every check constraint that lists the old source, remembering table and column
  create temporary table _src_cols (tbl regclass, col name, primary key (tbl, col)) on commit drop;
  create temporary table _src_checks (tbl regclass, cname name, def text) on commit drop;
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def, a.attname
      from pg_constraint c
      join pg_class k on k.oid = c.conrelid
      join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'c' and pg_get_constraintdef(c.oid) like '%''Claude MCP''%'
  loop
    insert into _src_cols values (r.tbl, r.attname) on conflict do nothing;
    insert into _src_checks values (r.tbl, r.conname, r.def) on conflict do nothing;
  end loop;
  -- columns that carry a source without a check constraint
  for r in
    select (quote_ident(n.nspname) || '.' || quote_ident(k.relname))::regclass as tbl, a.attname
      from pg_attribute a
      join pg_class k on k.oid = a.attrelid and k.relkind = 'r'
      join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
     where a.attnum > 0 and not a.attisdropped and a.atttypid = 'text'::regtype
       and (a.attname = 'via' or a.attname like '%\_via')
  loop
    insert into _src_cols values (r.tbl, r.attname) on conflict do nothing;
  end loop;
  for r in select * from _src_checks loop
    execute format('alter table %s drop constraint %I', r.tbl, r.cname);
  end loop;

  -- 1b. rewrite the values, with the user triggers (audit, write meta, guards, append-only) paused per table
  for t in select distinct tbl from _src_cols loop
    execute format('alter table %s disable trigger user', t.tbl);
  end loop;
  for r in select * from _src_cols loop
    execute format('update %s set %I = %L where %I = %L', r.tbl, r.col, 'MCP', r.col, 'Claude MCP');
  end loop;
  -- the audit rows that recorded a change of a source column hold the value in old / new
  update public.audit_log
     set old = case when old = to_jsonb('Claude MCP'::text) then to_jsonb('MCP'::text) else old end,
         new = case when new = to_jsonb('Claude MCP'::text) then to_jsonb('MCP'::text) else new end
   where field in ('created_via', 'saved_via', 'via') and (old = to_jsonb('Claude MCP'::text) or new = to_jsonb('Claude MCP'::text));
  -- AI name of the history: the connection's assistant when there is one, else Claude (the only assistant until now)
  update public.audit_log l
     set ai_tool = coalesce((select c.assistant from public.mcp_connections c where c.id = l.connection_id), 'claude')
   where l.via = 'MCP' and l.ai_tool is null;
  for t in select distinct tbl from _src_cols loop
    execute format('alter table %s enable trigger user', t.tbl);
  end loop;

  -- 1c. put the constraints back with the new value
  for r in select * from _src_checks loop
    execute format('alter table %s add constraint %I %s', r.tbl, r.cname, replace(r.def, '''Claude MCP''', '''MCP'''));
  end loop;

  -- 2a. policies
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public' and (coalesce(qual, '') like '%''Claude MCP''%' or coalesce(with_check, '') like '%''Claude MCP''%')
  loop
    execute format('alter policy %I on %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
      case when r.qual is not null then ' using (' || replace(r.qual, '''Claude MCP''', '''MCP''') || ')' else '' end,
      case when r.with_check is not null then ' with check (' || replace(r.with_check, '''Claude MCP''', '''MCP''') || ')' else '' end);
  end loop;

  -- 2b. functions (grants and owners stay: create or replace keeps them)
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname in ('public', 'pv_internal')
     where p.prokind in ('f', 'p') and p.prosrc like '%''Claude MCP''%'
  loop
    execute replace(r.def, '''Claude MCP''', '''MCP''');
  end loop;
end $$;

-- 3. the source of a call
create or replace function public.write_source() returns text
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(current_setting('app.via', true), '');
  oauth_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
begin
  if v is null then
    if oauth_client is not null then
      return 'MCP';
    end if;
    v := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-pv-via', '');
    if v in ('MCP', 'Claude MCP') then
      v := 'API'; -- forged: only an OAuth-issued token may carry this source
    end if;
  end if;
  if v is null then
    return case when auth.uid() is null then 'system' else 'API' end;
  end if;
  if v not in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system') then
    raise exception 'invalid write source: %', v;
  end if;
  return v;
end $$;

-- 4. connection, change set, AI name and AI model on every audit row written through an assistant
create or replace function public.audit_log_set_connection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.connection_id := case when new.via = 'MCP' then public.mcp_connection_for(new.tenant_id) else null end;
  new.change_set_id := case when new.via = 'MCP' and new.connection_id is not null then
    (select s.id from public.mcp_change_sets s
      where s.id = nullif(current_setting('pv.change_set', true), '')::uuid and s.connection_id = new.connection_id)
    else null end;
  if new.via = 'MCP' then
    new.ai_tool := coalesce((select c.assistant from public.mcp_connections c where c.id = new.connection_id), 'other');
    new.ai_model := nullif(left(btrim(regexp_replace(
      coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-pv-ai-model', ''), '[[:cntrl:]]', '', 'g')), 80), '');
  else
    new.ai_tool := null;
    new.ai_model := null;
  end if;
  return new;
end $$;

-- nothing may be left behind
do $$
declare n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname in ('public', 'pv_internal')
   where p.prokind in ('f', 'p') and p.prosrc like '%''Claude MCP''%' and p.proname <> 'write_source'; -- write_source() refuses the old name on purpose
  if n > 0 then raise exception 'migration incomplete: % function(s) still name Claude MCP', n; end if;
  select count(*) into n from pg_constraint c join pg_class k on k.oid = c.conrelid join pg_namespace s on s.oid = k.relnamespace and s.nspname = 'public'
   where pg_get_constraintdef(c.oid) like '%''Claude MCP''%';
  if n > 0 then raise exception 'migration incomplete: % constraint(s) still name Claude MCP', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and (coalesce(qual, '') like '%''Claude MCP''%' or coalesce(with_check, '') like '%''Claude MCP''%');
  if n > 0 then raise exception 'migration incomplete: % policy(ies) still name Claude MCP', n; end if;
end $$;
