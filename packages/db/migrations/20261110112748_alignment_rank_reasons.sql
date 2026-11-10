-- Issue #397: leadership decides the final order, the vote informs it. When an admin applies an order that differs from the one the vote suggested,
-- every initiative whose final rank differs gets a short reason (1 to 300 characters), kept with the application.
-- New table alignment_rank_reasons: per application and initiative the rank it had, the rank the admin gave it, the rank the vote suggested and the
--   reason. ADMINS ONLY (RLS select on my_admin_tenant_ids): a reason can hold commercial context ("a customer threatened to leave"), so members
--   never read it, it never reaches a tracker payload (nothing in sync reads this table) and the audit log (admins only) keeps it with the actor.
-- REPLACES alignment_rank_apply(uuid, jsonb, text) from 20261110010901 (same signature; merged in #398, no other open branch changes it). Changes:
--   the database now works out the rank the vote suggests for the chosen initiatives itself, from the stored snapshot (best place first, ties in their
--   current order, onto the held positions in order: the rule of @pv/domain suggestOrder), so a browser cannot claim an order matches the vote;
--   every initiative whose final rank differs from that needs a reason, otherwise PV026; the reasons are stored. A move may carry an optional `reason`.
--   All earlier checks stay: admin only, never MCP or a service account (PV004), a closed session with results, a reorder of held positions,
--   the ranks still as seen (PV025). Nothing is applied when no rank would change.
-- New: item_alignment_decisions(): the reasons of one initiative for the item panel, admins only, not for undone applications.
-- alignment_rank_undo() is unchanged: the reasons stay with the (undone) application.
-- No DROP statements.
-- the (tenant_id, id) key the new foreign key needs
alter table public.alignment_rank_applications add constraint alignment_rank_applications_tenant_id_key unique (tenant_id, id);

create table public.alignment_rank_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  item_id uuid not null,
  from_rank integer not null check (from_rank >= 1),
  to_rank integer not null check (to_rank >= 1),
  crowd_rank integer not null check (crowd_rank >= 1),
  reason text not null check (char_length(reason) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, application_id) references public.alignment_rank_applications (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  unique (application_id, item_id),
  check (to_rank <> crowd_rank)
);
create index alignment_rank_reasons_application on public.alignment_rank_reasons (tenant_id, application_id);
create index alignment_rank_reasons_item on public.alignment_rank_reasons (tenant_id, item_id);
create trigger alignment_rank_reasons_meta before insert or update on public.alignment_rank_reasons
  for each row execute function public.set_write_meta();
create trigger alignment_rank_reasons_audit after insert or update on public.alignment_rank_reasons
  for each row execute function public.audit_row();
-- platform staff read, never write, customer data (rule 10)
create trigger a_platform_readonly_guard before insert or update or delete on public.alignment_rank_reasons
  for each row execute function platform.readonly_guard();
alter table public.alignment_rank_reasons enable row level security;
create policy alignment_rank_reasons_select on public.alignment_rank_reasons for select to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.alignment_rank_reasons from public, anon, authenticated;
grant select on public.alignment_rank_reasons to authenticated;
grant all on public.alignment_rank_reasons to service_role;

create or replace function public.alignment_rank_apply(p_session uuid, p_moves jsonb, p_scope text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_n integer; v_items integer; v_from integer; v_to integer; v_bad boolean;
  v_all jsonb;
  v_stored jsonb;
  v_id uuid;
  v_missing text;
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
    from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int, reason text);
  if v_bad then raise exception 'Bad ranks.' using errcode = '22023'; end if;
  if v_n <> v_items then raise exception 'An initiative is listed twice.' using errcode = '22023'; end if;
  -- a reorder of positions already held: the same ranks before and after, each once
  if v_n <> v_from or v_n <> v_to
     or (select array_agg(r."from" order by r."from") from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int, reason text))
        is distinct from (select array_agg(r."to" order by r."to") from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int, reason text)) then
    raise exception 'The moves must reorder the positions these initiatives already hold.' using errcode = '22023';
  end if;
  -- every initiative is in this session, live, in the default rank
  if exists (
    select 1 from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int, reason text)
     where not exists (select 1 from public.alignment_items ai where ai.session_id = p_session and ai.tenant_id = s.tenant_id and ai.item_id = r.item)
        or not exists (select 1 from public.items i where i.id = r.item and i.tenant_id = s.tenant_id and i.deleted_at is null and i.cycle_id is null)
  ) then
    raise exception 'Some initiatives are not part of this session or are not in the Stack Rank.' using errcode = '22023';
  end if;
  -- the rank is still what the person saw
  if exists (select 1 from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int, reason text) join public.items i on i.id = r.item where i.stack_rank is distinct from r."from") then
    raise exception 'The order changed since you looked at it. Open the suggestion again.' using errcode = 'PV025';
  end if;

  -- the rank the vote suggests for exactly these initiatives, from the stored snapshot (the rule of @pv/domain suggestOrder)
  with m as (select r.item, r."from", r."to", nullif(regexp_replace(btrim(coalesce(r.reason, '')), '\s+', ' ', 'g'), '') as reason
               from jsonb_to_recordset(p_moves) as r(item uuid, "from" int, "to" int, reason text)),
       v as (select m.item, m."from", (j.e ->> 'place')::int as place
               from m
               join public.alignment_items ai on ai.session_id = p_session and ai.item_id = m.item
               join lateral (select e from jsonb_array_elements(s.results_snapshot -> 'results' -> 'joint') e where e ->> 'itemId' = ai.id::text limit 1) j on true),
       ranked as (select item, row_number() over (order by place, "from", item) as n from v),
       slots as (select "from", row_number() over (order by "from") as n from m)
  select jsonb_agg(jsonb_build_object('item', m.item, 'from', m."from", 'to', m."to", 'crowd_to', slots."from", 'reason', m.reason, 'prev_previous', i.previous_rank) order by m."to")
    into v_all
    from m join ranked on ranked.item = m.item join slots on slots.n = ranked.n join public.items i on i.id = m.item;
  if v_all is null or jsonb_array_length(v_all) <> v_n then
    raise exception 'Some initiatives have no place in the vote of this session.' using errcode = '22023';
  end if;

  -- every initiative whose final rank is not the one the vote suggests needs a reason of 1 to 300 characters
  select string_agg(i.initiative_name, ', ') into v_missing
    from jsonb_to_recordset(v_all) as a(item uuid, "from" int, "to" int, crowd_to int, reason text, prev_previous int)
    join public.items i on i.id = a.item
   where a."to" <> a.crowd_to and (a.reason is null or char_length(a.reason) > 300);
  if v_missing is not null then
    raise exception 'Give a reason of 1 to 300 characters for every initiative whose rank differs from the vote: %.', v_missing using errcode = 'PV026';
  end if;

  select jsonb_agg(jsonb_build_object('item', a.item, 'from', a."from", 'to', a."to", 'prev_previous', a.prev_previous) order by a."to")
    into v_stored from jsonb_to_recordset(v_all) as a(item uuid, "from" int, "to" int, crowd_to int, reason text, prev_previous int) where a."from" <> a."to";
  if v_stored is null then raise exception 'The Stack Rank would not change, so there is nothing to apply.' using errcode = '22023'; end if;

  perform set_config('pv.rank_internal', 'on', true);
  update public.items i set stack_rank = a."to", previous_rank = a."from"
    from jsonb_to_recordset(v_all) as a(item uuid, "from" int, "to" int, crowd_to int, reason text, prev_previous int) where i.id = a.item and a."from" <> a."to";
  perform set_config('pv.rank_internal', 'off', true);

  insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved)
    values (s.tenant_id, p_session, p_scope, v_stored, jsonb_array_length(v_stored)) returning id into v_id;
  insert into public.alignment_rank_reasons (tenant_id, application_id, item_id, from_rank, to_rank, crowd_rank, reason)
    select s.tenant_id, v_id, a.item, a."from", a."to", a.crowd_to, a.reason
      from jsonb_to_recordset(v_all) as a(item uuid, "from" int, "to" int, crowd_to int, reason text, prev_previous int) where a."to" <> a.crowd_to;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (s.tenant_id, 'alignment_sessions', s.id, 'rank_applied', null,
          jsonb_build_object('application', v_id, 'moved', jsonb_array_length(v_stored), 'scope', p_scope, 'session', s.name,
                             'differs_from_vote', (select count(*) from jsonb_to_recordset(v_all) as a(item uuid, "from" int, "to" int, crowd_to int, reason text, prev_previous int) where a."to" <> a.crowd_to)),
          auth.uid(), public.write_source());
  return v_id;
end $$;
revoke all on function public.alignment_rank_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.alignment_rank_apply(uuid, jsonb, text) to authenticated;

-- The reasons of one initiative, for the Alignment tab of the item panel. Admins only (members get no rows), and not for applications that were undone.
create function public.item_alignment_decisions(p_tenant uuid, p_item uuid)
returns table (session_id uuid, session_name text, applied_at timestamptz, from_rank integer, to_rank integer, crowd_rank integer, reason text)
language sql stable security definer set search_path = '' as $$
  select a.session_id, s.name, a.created_at, r.from_rank, r.to_rank, r.crowd_rank, r.reason
    from public.alignment_rank_reasons r
    join public.alignment_rank_applications a on a.tenant_id = r.tenant_id and a.id = r.application_id
    join public.alignment_sessions s on s.tenant_id = a.tenant_id and s.id = a.session_id
   where r.tenant_id = p_tenant
     and p_tenant = any (array (select public.my_admin_tenant_ids()))
     and r.item_id = p_item
     and a.undone_at is null
   order by a.created_at desc, r.id;
$$;
revoke all on function public.item_alignment_decisions(uuid, uuid) from public, anon;
grant execute on function public.item_alignment_decisions(uuid, uuid) to authenticated;
