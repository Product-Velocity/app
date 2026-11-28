-- Issue #746, slice 3: coin defaults per project, and the card voters can open (docs/decisions/2026-11-28-alignment-moscow-and-small-groups.md).
-- 1. projects get a default for the coins of a vote: total per person and the most on one initiative (100 and 30 unless an admin sets another). A new
--    session takes the default of the project its initiatives belong to when they all belong to one project (alignment_session_use_project_defaults);
--    otherwise it keeps 100 and 30. The values stay editable on the draft and lock when the session opens, so a later change to the project never
--    alters a running vote. Admins only (project_alignment_defaults_set).
-- 2. alignment_items snapshot three more fields when a session opens, for the "More" card: Business Line, Business Value (12 months) and Effort. Which of
--    them are copied is the session's `voter_fields` (all three by default; an admin can untick any, Business Value being commercial); an unticked field is
--    never copied, so nothing the admin did not choose can reach a voter. `voter_fields` locks when the session opens like the other settings.
-- Replaced: alignment_sessions_lock (adds voter_fields to the locked settings) and alignment_session_set_state (the snapshot copies the three fields).
--   No other open branch replaces either (checked against the open pull requests).
alter table public.projects
  add column alignment_coins_total integer not null default 100 check (alignment_coins_total between 10 and 1000),
  add column alignment_coins_max_per_item integer not null default 30 check (alignment_coins_max_per_item between 1 and 1000),
  add constraint projects_alignment_coins_check check (alignment_coins_max_per_item <= alignment_coins_total);

alter table public.alignment_items
  add column shown_business_line text check (char_length(shown_business_line) <= 200),
  add column shown_business_value numeric,
  add column shown_effort text check (shown_effort in ('XS', 'S', 'M', 'L', 'XL'));

alter table public.alignment_sessions
  add column voter_fields text[] not null default array['business_line', 'business_value', 'effort']::text[]
    check (voter_fields <@ array['business_line', 'business_value', 'effort']::text[]);

create or replace function public.alignment_sessions_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- settings are locked once the session is open; the state itself, the times it was opened and closed and the results can still change
  if old.status <> 'draft' and (
       new.name, new.method, new.groups, new.weighting, new.excluded_groups, new.coins_total, new.coins_max_per_item, new.show_results, new.retention_months, new.cycle_id, new.opens_at, new.voter_fields
     ) is distinct from (
       old.name, old.method, old.groups, old.weighting, old.excluded_groups, old.coins_total, old.coins_max_per_item, old.show_results, old.retention_months, old.cycle_id, old.opens_at, old.voter_fields
     ) then
    raise exception 'The settings of an open session are locked. Make a new session instead.' using errcode = 'PV009';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'An archived session stays archived.' using errcode = 'PV009';
  end if;
  return new;
end $$;

-- draft -> open (snapshots what participants will see), open -> closed, closed -> archived. Admin only.
create or replace function public.alignment_session_set_state(p_id uuid, p_state text)
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
    -- what participants will see: name, summary and value proposition (customer-safe fields), plus only the card fields the admin left ticked
    update public.alignment_items a set shown_name = left(i.initiative_name, 200), shown_summary = left(i.summary, 2000),
           shown_value_proposition = left(i.value_proposition, 2000),
           shown_business_line = case when 'business_line' = any (s.voter_fields) then left(i.business_line, 200) end,
           shown_business_value = case when 'business_value' = any (s.voter_fields) then i.value_12m end,
           shown_effort = case when 'effort' = any (s.voter_fields) then i.effort end,
           snapshot_at = now()
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

-- Which card fields voters can open (draft only: the lock trigger refuses anything else).
create function public.alignment_session_set_voter_fields(p_id uuid, p_fields text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_fields text[];
begin
  select * into s from public.alignment_sessions where id = p_id for update;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  v_fields := coalesce((select array_agg(distinct f order by f) from unnest(coalesce(p_fields, '{}'::text[])) f), '{}'::text[]);
  if not (v_fields <@ array['business_line', 'business_value', 'effort']::text[]) then raise exception 'Unknown card field.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_sessions set voter_fields = v_fields where id = p_id;
end $$;
revoke all on function public.alignment_session_set_voter_fields(uuid, text[]) from public, anon;
grant execute on function public.alignment_session_set_voter_fields(uuid, text[]) to authenticated;

-- The coin defaults of a project (admins of the workspace only).
create function public.project_alignment_defaults_set(p_project uuid, p_total integer, p_max integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this project.' using errcode = '42501';
  end if;
  if p_total is null or p_max is null or p_total not between 10 and 1000 or p_max not between 1 and 1000 or p_max > p_total then
    raise exception 'The total must be 10 to 1000 coins and the most on one initiative between 1 and the total.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.projects set alignment_coins_total = p_total, alignment_coins_max_per_item = p_max where id = p_project;
end $$;
revoke all on function public.project_alignment_defaults_set(uuid, integer, integer) from public, anon;
grant execute on function public.project_alignment_defaults_set(uuid, integer, integer) to authenticated;

-- A new draft takes the coin defaults of the project its initiatives belong to, when they all belong to one project.
create function public.alignment_session_use_project_defaults(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_projects uuid[];
  p public.projects%rowtype;
begin
  select * into s from public.alignment_sessions where id = p_id for update;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  if s.status <> 'draft' then return; end if;
  select array_agg(distinct i.home_project_id) into v_projects
    from public.alignment_items a join public.items i on i.id = a.item_id where a.session_id = p_id;
  if coalesce(array_length(v_projects, 1), 0) <> 1 or v_projects[1] is null then return; end if;
  select * into p from public.projects where id = v_projects[1] and tenant_id = s.tenant_id;
  if not found then return; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_sessions set coins_total = p.alignment_coins_total, coins_max_per_item = p.alignment_coins_max_per_item where id = p_id;
end $$;
revoke all on function public.alignment_session_use_project_defaults(uuid) from public, anon;
grant execute on function public.alignment_session_use_project_defaults(uuid) to authenticated;
