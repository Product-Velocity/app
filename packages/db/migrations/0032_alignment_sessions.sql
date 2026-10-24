-- 0032: alignment sessions, setup and scope (issue #123). Privacy model: docs/19-ALIGNMENT-PRIVACY.md (agreed by Ashu 2026-10-24).
-- alignment_sessions: a ranking session over a set of initiatives. States draft, open, closed, archived. Method top5_duels, coins or ice.
--   groups: the segments voters belong to, [{id, name}] (role, region, customer type...). Weighting equal or headcount. A group can be excluded
--   from the joint score. Once the session is open its settings are locked (a change needs a new session). closes_at closes it automatically
--   (alignment_close_due()). show_results: whether participants may see the anonymous results after close (default off).
-- alignment_items: the initiatives of a session, with a SNAPSHOT of what participants will see taken when the session opens: name, summary and
--   value proposition only (customer-safe fields). Commercial fields are never copied. Later edits of the initiative do not change the session.
-- Nothing here is readable by participants (they have no database role); members read sessions and their items, admins change them through functions.
-- participants, ballots and votes arrive with #124 and #125; they hold personal data and follow the privacy note.
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
create table public.alignment_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  method text not null check (method in ('top5_duels', 'coins', 'ice')),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'archived')),
  groups jsonb not null default '[]' check (jsonb_typeof(groups) = 'array'),
  weighting text not null default 'equal' check (weighting in ('equal', 'headcount')),
  excluded_groups text[] not null default '{}',
  coins_total integer not null default 100 check (coins_total between 10 and 1000),
  coins_max_per_item integer not null default 30 check (coins_max_per_item between 1 and 1000),
  show_results boolean not null default false,
  retention_months integer not null default 12 check (retention_months between 1 and 120),
  cycle_id uuid,
  opens_at timestamptz,
  closes_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  results_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id),
  check (coins_max_per_item <= coins_total)
);
create index alignment_sessions_tenant on public.alignment_sessions (tenant_id, status);
create trigger alignment_sessions_meta before insert or update on public.alignment_sessions
  for each row execute function public.set_write_meta();
create trigger alignment_sessions_audit after insert or update on public.alignment_sessions
  for each row execute function public.audit_row();

create function public.alignment_sessions_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- settings are locked once the session is open; the state itself, the times it was opened and closed and the results can still change
  if old.status <> 'draft' and (
       new.name, new.method, new.groups, new.weighting, new.excluded_groups, new.coins_total, new.coins_max_per_item, new.show_results, new.retention_months, new.cycle_id, new.opens_at
     ) is distinct from (
       old.name, old.method, old.groups, old.weighting, old.excluded_groups, old.coins_total, old.coins_max_per_item, old.show_results, old.retention_months, old.cycle_id, old.opens_at
     ) then
    raise exception 'The settings of an open session are locked. Make a new session instead.' using errcode = 'PV009';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'An archived session stays archived.' using errcode = 'PV009';
  end if;
  return new;
end $$;
create trigger alignment_sessions_lock before update on public.alignment_sessions
  for each row execute function public.alignment_sessions_lock();

alter table public.alignment_sessions enable row level security;
create policy alignment_sessions_select on public.alignment_sessions for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.alignment_sessions from public, anon, authenticated;
grant select on public.alignment_sessions to authenticated;
grant all on public.alignment_sessions to service_role;

create table public.alignment_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  item_id uuid,
  position integer not null check (position >= 1),
  shown_name text check (char_length(shown_name) <= 200),
  shown_summary text check (char_length(shown_summary) <= 2000),
  shown_value_proposition text check (char_length(shown_value_proposition) <= 2000),
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete set null (item_id),
  unique (session_id, item_id)
);
create index alignment_items_session on public.alignment_items (tenant_id, session_id, position);
create trigger alignment_items_meta before insert or update on public.alignment_items
  for each row execute function public.set_write_meta();
create trigger alignment_items_audit after insert or update on public.alignment_items
  for each row execute function public.audit_row();
alter table public.alignment_items enable row level security;
create policy alignment_items_select on public.alignment_items for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.alignment_items from public, anon, authenticated;
grant select on public.alignment_items to authenticated;
grant all on public.alignment_items to service_role;

-- Admins create a draft from a selection of initiatives (any selection until planning cycles exist).
create function public.alignment_session_create(p_name text, p_method text, p_item_ids uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_n integer;
begin
  select i.tenant_id into v_tenant from public.items i where i.id = p_item_ids[1];
  if v_tenant is null or v_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'Only admins can create alignment sessions.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) not between 2 and 100 then raise exception 'Choose between 2 and 100 initiatives.' using errcode = '22023'; end if;
  select count(*) into v_n from public.items i where i.id = any (p_item_ids) and i.tenant_id = v_tenant and i.deleted_at is null;
  if v_n <> (select count(distinct x) from unnest(p_item_ids) x) then raise exception 'Some initiatives were not found.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  insert into public.alignment_sessions (tenant_id, name, method, groups) values (v_tenant, btrim(p_name), p_method, '[{"id":"everyone","name":"Everyone"}]'::jsonb) returning id into v_id;
  insert into public.alignment_items (tenant_id, session_id, item_id, position)
    select v_tenant, v_id, x.item, x.pos from (select u.item, min(u.ord)::int as pos from unnest(p_item_ids) with ordinality as u(item, ord) group by u.item) x
     where x.item in (select i.id from public.items i where i.tenant_id = v_tenant);
  return v_id;
end $$;
revoke all on function public.alignment_session_create(text, text, uuid[]) from public, anon;
grant execute on function public.alignment_session_create(text, text, uuid[]) to authenticated;

-- Draft settings (draft only; the lock trigger refuses anything else).
create function public.alignment_session_configure(
  p_id uuid, p_name text, p_method text, p_groups jsonb, p_weighting text, p_excluded text[], p_coins_total integer, p_coins_max integer,
  p_show_results boolean, p_retention integer, p_closes_at timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
begin
  select * into s from public.alignment_sessions where id = p_id for update;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 12 then raise exception 'Define 1 to 12 groups.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_sessions set name = btrim(p_name), method = p_method, groups = p_groups, weighting = p_weighting,
         excluded_groups = coalesce(p_excluded, '{}'), coins_total = p_coins_total, coins_max_per_item = p_coins_max,
         show_results = p_show_results, retention_months = p_retention, closes_at = p_closes_at
   where id = p_id;
end $$;
revoke all on function public.alignment_session_configure(uuid, text, text, jsonb, text, text[], integer, integer, boolean, integer, timestamptz) from public, anon;
grant execute on function public.alignment_session_configure(uuid, text, text, jsonb, text, text[], integer, integer, boolean, integer, timestamptz) to authenticated;

-- draft -> open (snapshots what participants will see), open -> closed, closed -> archived. Admin only.
create function public.alignment_session_set_state(p_id uuid, p_state text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
begin
  select * into s from public.alignment_sessions where id = p_id for update;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  if p_state = 'open' and s.status = 'draft' then
    if (select count(*) from public.alignment_items a where a.session_id = p_id) < 2 then raise exception 'A session needs at least 2 initiatives.' using errcode = '22023'; end if;
    if s.closes_at is not null and s.closes_at <= now() then raise exception 'The closing time is in the past.' using errcode = '22023'; end if;
    -- what participants will see: name, summary and value proposition (customer-safe fields), never a commercial field
    update public.alignment_items a set shown_name = left(i.initiative_name, 200), shown_summary = left(i.summary, 2000),
           shown_value_proposition = left(i.value_proposition, 2000), snapshot_at = now()
      from public.items i where a.session_id = p_id and i.id = a.item_id;
    update public.alignment_sessions set status = 'open', opened_at = now() where id = p_id;
  elsif p_state = 'closed' and s.status = 'open' then
    update public.alignment_sessions set status = 'closed', closed_at = now() where id = p_id;
  elsif p_state = 'archived' and s.status = 'closed' then
    update public.alignment_sessions set status = 'archived' where id = p_id;
  else
    raise exception 'A % session cannot become %.', s.status, p_state using errcode = '22023';
  end if;
end $$;
revoke all on function public.alignment_session_set_state(uuid, text) from public, anon;
grant execute on function public.alignment_session_set_state(uuid, text) to authenticated;

-- Closes the open sessions whose closing time has passed. Called by the daily cron and whenever the list is opened.
create function public.alignment_close_due(p_tenant uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  -- a signed-in person closes only their own workspace's due sessions; the cron (service role, no person) does all
  if auth.uid() is not null and (p_tenant is null or p_tenant <> all (array (select public.my_tenant_ids()))) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  perform set_config('app.via', 'system', true);
  update public.alignment_sessions set status = 'closed', closed_at = now()
   where status = 'open' and closes_at is not null and closes_at <= now() and (p_tenant is null or tenant_id = p_tenant);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.alignment_close_due(uuid) from public, anon;
grant execute on function public.alignment_close_due(uuid) to authenticated, service_role;
