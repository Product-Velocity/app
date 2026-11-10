-- Issue #394: apply the vote of a closed alignment session to the Stack Rank, as one audited change that can be undone.
-- New table alignment_rank_applications: one row per application (session, who and when through the usual created_by / created_at / created_via,
--   the moves {item, from, to, prev_previous} so an undo can restore the order exactly, and when it was undone). Members read it (RLS on the fast
--   pattern); nobody writes it directly: only the two functions below do.
-- alignment_rank_apply(session, moves, scope): an admin, never Claude or a service account (PV004). The session must be closed with stored results.
--   The moves are a REORDER of positions the voted initiatives already hold (the same set of ranks before and after, each once), so nothing
--   outside the vote moves and no gap or duplicate is made. Each initiative must be in the session, live, in the default (global) rank, and still
--   at the rank the person saw (`from`), otherwise PV025: the order changed since the preview and the person is asked again. Writes only stack_rank
--   and previous_rank (as move_item does), takes the same advisory lock as move_item, and adds one audit entry on the session.
-- alignment_rank_undo(application): restores stack_rank and previous_rank exactly, only if every initiative is still where the application put it
--   (otherwise PV025: undoing would overwrite a later change), and only once.
-- New objects only: no replaced function, no DROP.
create table public.alignment_rank_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  scope text not null check (scope in ('all', 'selection')),
  moves jsonb not null check (jsonb_typeof(moves) = 'array'),
  moved integer not null check (moved >= 1),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade
);
create index alignment_rank_applications_session on public.alignment_rank_applications (tenant_id, session_id, created_at desc);
create trigger alignment_rank_applications_meta before insert or update on public.alignment_rank_applications
  for each row execute function public.set_write_meta();
create trigger alignment_rank_applications_audit after insert or update on public.alignment_rank_applications
  for each row execute function public.audit_row();
-- platform staff read, never write, customer data (rule 10): the read-only guard goes on every table that carries a tenant
create trigger a_platform_readonly_guard before insert or update or delete on public.alignment_rank_applications
  for each row execute function platform.readonly_guard();
alter table public.alignment_rank_applications enable row level security;
create policy alignment_rank_applications_select on public.alignment_rank_applications for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.alignment_rank_applications from public, anon, authenticated;
grant select on public.alignment_rank_applications to authenticated;
grant all on public.alignment_rank_applications to service_role;

create function public.alignment_rank_apply(p_session uuid, p_moves jsonb, p_scope text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_n integer; v_items integer; v_from integer; v_to integer; v_bad boolean;
  v_stored jsonb;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.write_source() = 'MCP' or exists (
    select 1 from public.tenant_members m where m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot set Stack Rank; a person applies the vote' using errcode = 'PV004';
  end if;
  select * into s from public.alignment_sessions where id = p_session;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot apply the result of this session.' using errcode = '42501';
  end if;
  if s.status not in ('closed', 'archived') or s.results_snapshot is null then
    raise exception 'The session has no final results yet.' using errcode = '22023';
  end if;
  if p_scope not in ('all', 'selection') then raise exception 'Bad scope.' using errcode = '22023'; end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) not between 2 and 100 then
    raise exception 'Choose between 2 and 100 initiatives to reorder.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  perform pg_advisory_xact_lock(hashtextextended(s.tenant_id::text || '', 0)); -- the same lock as move_item (default rank, no cycle)

  select count(*), count(distinct r.item), count(distinct r."from"), count(distinct r."to"), bool_or(r."from" is null or r."to" is null or r."from" < 1 or r."to" < 1)
    into v_n, v_items, v_from, v_to, v_bad
    from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int);
  if v_bad then raise exception 'Bad ranks.' using errcode = '22023'; end if;
  if v_n <> v_items then raise exception 'An initiative is listed twice.' using errcode = '22023'; end if;
  -- a reorder of positions already held: the same ranks before and after, each once
  if v_n <> v_from or v_n <> v_to
     or (select array_agg(r."from" order by r."from") from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int))
        is distinct from (select array_agg(r."to" order by r."to") from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int)) then
    raise exception 'The moves must reorder the positions these initiatives already hold.' using errcode = '22023';
  end if;
  -- every initiative is in this session, live, in the default rank
  if exists (
    select 1 from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int)
     where not exists (select 1 from public.alignment_items ai where ai.session_id = p_session and ai.tenant_id = s.tenant_id and ai.item_id = r.item)
        or not exists (select 1 from public.items i where i.id = r.item and i.tenant_id = s.tenant_id and i.deleted_at is null and i.cycle_id is null)
  ) then
    raise exception 'Some initiatives are not part of this session or are not in the Stack Rank.' using errcode = '22023';
  end if;
  -- the rank is still what the person saw
  if exists (select 1 from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int) join public.items i on i.id = r.item where i.stack_rank is distinct from r."from") then
    raise exception 'The order changed since you looked at it. Open the suggestion again.' using errcode = 'PV025';
  end if;

  select jsonb_agg(jsonb_build_object('item', r.item, 'from', r."from", 'to', r."to", 'prev_previous', i.previous_rank) order by r."to")
    into v_stored from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int) join public.items i on i.id = r.item where r."from" <> r."to";
  if v_stored is null then raise exception 'The team already ranks these initiatives as the vote does.' using errcode = '22023'; end if;

  perform set_config('pv.rank_internal', 'on', true);
  update public.items i set stack_rank = r."to", previous_rank = r."from"
    from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int) where i.id = r.item and r."from" <> r."to";
  perform set_config('pv.rank_internal', 'off', true);

  insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved)
    values (s.tenant_id, p_session, p_scope, v_stored, jsonb_array_length(v_stored)) returning id into v_id;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (s.tenant_id, 'alignment_sessions', s.id, 'rank_applied', null, jsonb_build_object('application', v_id, 'moved', jsonb_array_length(v_stored), 'scope', p_scope, 'session', s.name), auth.uid(), public.write_source());
  return v_id;
end $$;
revoke all on function public.alignment_rank_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.alignment_rank_apply(uuid, jsonb, text) to authenticated;

create function public.alignment_rank_undo(p_application uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.alignment_rank_applications%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.write_source() = 'MCP' or exists (
    select 1 from public.tenant_members m where m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot set Stack Rank' using errcode = 'PV004';
  end if;
  select * into a from public.alignment_rank_applications where id = p_application for update;
  if not found or a.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot undo this.' using errcode = '42501';
  end if;
  if a.undone_at is not null then raise exception 'This was already undone.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text || '', 0));
  -- every initiative must still be where the application put it, or the undo would overwrite a later change
  if exists (
    select 1 from jsonb_to_recordset(a.moves) as m(item uuid, "from" int, "to" int, prev_previous int)
     where not exists (select 1 from public.items i where i.id = m.item and i.deleted_at is null and i.stack_rank = m."to")
  ) then
    raise exception 'The order changed after this was applied, so it cannot be undone without overwriting that change.' using errcode = 'PV025';
  end if;
  perform set_config('pv.rank_internal', 'on', true);
  update public.items i set stack_rank = m."from", previous_rank = m.prev_previous
    from jsonb_to_recordset(a.moves) as m(item uuid, "from" int, "to" int, prev_previous int) where i.id = m.item;
  perform set_config('pv.rank_internal', 'off', true);
  update public.alignment_rank_applications set undone_at = now(), undone_by = auth.uid() where id = a.id;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (a.tenant_id, 'alignment_sessions', a.session_id, 'rank_apply_undone', jsonb_build_object('application', a.id), jsonb_build_object('moved', a.moved), auth.uid(), public.write_source());
end $$;
revoke all on function public.alignment_rank_undo(uuid) from public, anon;
grant execute on function public.alignment_rank_undo(uuid) to authenticated;
