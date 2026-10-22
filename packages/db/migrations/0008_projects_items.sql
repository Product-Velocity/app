-- Phase 1 core: projects, teams (basic), items with one global stack rank,
-- saved scopes. docs/03-DATA-MODEL.md; RLS pattern from spike S7.
-- No DROP statements: applied to Supabase through a tool that pauses on them.

-- ---------------------------------------------------------------------------
-- Fast RLS helpers (spike S7): evaluated once per query, not once per row.
-- Use as   tenant_id = any(array(select public.my_tenant_ids()))
-- ---------------------------------------------------------------------------
create function public.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid()
$$;
create function public.my_editor_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and role in ('creator', 'admin')
$$;
create function public.my_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and role = 'admin'
$$;
revoke all on function public.my_tenant_ids(), public.my_editor_tenant_ids(), public.my_admin_tenant_ids() from public, anon;
grant execute on function public.my_tenant_ids(), public.my_editor_tenant_ids(), public.my_admin_tenant_ids() to authenticated;

-- audit_log is the biggest table: use the fast admin pattern (was is_tenant_admin(tenant_id) per row)
alter policy audit_log_select on public.audit_log
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  default_repo text check (default_repo is null or default_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  who_breaks_down text not null default 'either' check (who_breaks_down in ('product', 'engineering', 'either')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id)
);
create unique index projects_name_unique on public.projects (tenant_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- teams (basic): capacity settings only for now (docs/01 section 4.6)
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  focus_factor numeric(3, 2) not null default 0.80 check (focus_factor > 0 and focus_factor <= 1),
  split_maintenance int not null default 25 check (split_maintenance >= 0),
  split_bugs int not null default 25 check (split_bugs >= 0),
  split_new int not null default 50 check (split_new >= 0),
  week_hours numeric(4, 1) not null default 40 check (week_hours > 0 and week_hours <= 80),
  github_team text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id),
  constraint team_time_split_adds_up check (split_maintenance + split_bugs + split_new = 100)
);
create unique index teams_name_unique on public.teams (tenant_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- items (initiatives)
-- ---------------------------------------------------------------------------
create schema pv_internal;
revoke all on schema pv_internal from public, anon, authenticated;
create table pv_internal.item_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number int not null default 0
);
alter table pv_internal.item_counters enable row level security; -- no policies: internal only

create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  summary text check (char_length(summary) <= 4000),             -- customer-safe
  value_proposition text check (char_length(value_proposition) <= 4000), -- customer-safe
  target_segments text[] not null default '{}',
  home_project_id uuid not null,
  theme text check (char_length(theme) <= 120),
  owner_user_id uuid,
  -- priority
  stack_rank int not null check (stack_rank >= 1),
  previous_rank int check (previous_rank >= 1),
  cycle_id uuid,                       -- planning cycles arrive in Phase 5; null = no cycle
  moscow text check (moscow in ('must', 'should', 'could', 'wont')),
  horizon text check (char_length(horizon) <= 60),
  focus_area text check (char_length(focus_area) <= 120),
  value numeric(14, 2) check (value >= 0),                        -- commercial, humans only
  confidence smallint check (confidence between 0 and 100),       -- commercial
  size text check (size in ('XS', 'S', 'M', 'L', 'XL')),
  effort_by_skill jsonb not null default '{}' check (jsonb_typeof(effort_by_skill) = 'object'),
  decision text check (char_length(decision) <= 200),             -- commercial, humans only
  -- timing
  start_date date,
  end_date date,
  date_precision text not null default 'day' check (date_precision in ('day', 'month', 'quarter')),
  health text check (health in ('on_track', 'at_risk', 'delayed')),
  -- GitHub-driven: read-only in the app, written by the sync engine (service role) only
  status text,
  delivery_progress numeric(5, 2) check (delivery_progress between 0 and 100),
  planned_scope int check (planned_scope >= 0),
  scope_added int check (scope_added >= 0),
  github_issue_url text,
  last_synced_at timestamptz,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id),
  unique (tenant_id, key),
  constraint items_dates_in_order check (start_date is null or end_date is null or end_date >= start_date),
  -- one global rank list per tenant and planning cycle; checked at commit so a
  -- re-rank can renumber many rows in one transaction
  constraint items_rank_unique unique nulls not distinct (tenant_id, cycle_id, stack_rank) deferrable initially deferred,
  -- references can never cross tenants
  foreign key (tenant_id, home_project_id) references public.projects (tenant_id, id),
  foreign key (tenant_id, owner_user_id) references public.tenant_members (tenant_id, user_id)
    on delete set null (owner_user_id)
);
create index items_project_idx on public.items (tenant_id, home_project_id);
create index items_owner_idx on public.items (tenant_id, owner_user_id);

create table public.item_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  team_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (item_id, team_id),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references public.teams (tenant_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- saved scopes (portfolio scopes): a named set of projects; they filter, they never own a rank
-- ---------------------------------------------------------------------------
create table public.saved_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id)
);
create unique index saved_scopes_name_unique on public.saved_scopes (tenant_id, lower(btrim(name)));

create table public.saved_scope_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scope_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (scope_id, project_id),
  foreign key (tenant_id, scope_id) references public.saved_scopes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Item behaviour
-- ---------------------------------------------------------------------------
-- New items get the next key (R-01, R-02, ...) and the last rank of their cycle.
-- The counter row is locked first, so concurrent inserts for a tenant queue up.
create function public.items_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into pv_internal.item_counters (tenant_id, last_number) values (new.tenant_id, 1)
  on conflict (tenant_id) do update set last_number = pv_internal.item_counters.last_number + 1
  returning last_number into n;
  new.key := 'R-' || lpad(n::text, 2, '0');
  select coalesce(max(i.stack_rank), 0) + 1 into new.stack_rank
    from public.items i
   where i.tenant_id = new.tenant_id and i.cycle_id is not distinct from new.cycle_id;
  return new;
end $$;

-- Claude and service accounts never set Stack Rank, Decision or Value (CLAUDE.md rule 3).
create function public.items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_blocked boolean;
begin
  v_blocked := public.write_source() = 'Claude MCP'
    or exists (
      select 1 from public.tenant_members m
       where m.tenant_id = new.tenant_id and m.user_id = auth.uid() and m.is_service_account
    );
  if v_blocked then
    if tg_op = 'INSERT' then
      if new.value is not null or new.decision is not null then
        raise exception 'Claude and service accounts cannot set Value or Decision' using errcode = 'PV004';
      end if;
    elsif new.value is distinct from old.value
       or new.decision is distinct from old.decision
       or (new.stack_rank is distinct from old.stack_rank
           and coalesce(current_setting('pv.rank_internal', true), '') <> 'on') then
      raise exception 'Claude and service accounts cannot set Stack Rank, Value or Decision' using errcode = 'PV004';
    end if;
  end if;
  return new;
end $$;

-- Re-rank: move one item to a position; everything in between shifts by one.
-- One transaction, unique ranks checked at commit, one audit row per changed item.
create function public.move_item(p_item uuid, p_new_rank int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_cycle uuid; v_old int; v_max int; v_new int;
begin
  select i.tenant_id, i.cycle_id, i.stack_rank into v_tenant, v_cycle, v_old
    from public.items i where i.id = p_item;
  if v_tenant is null or not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.role in ('creator', 'admin')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if public.write_source() = 'Claude MCP' or exists (
    select 1 from public.tenant_members m
     where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot set Stack Rank' using errcode = 'PV004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || coalesce(v_cycle::text, ''), 0));
  select i.stack_rank into v_old from public.items i where i.id = p_item; 
  select max(i.stack_rank) into v_max from public.items i
   where i.tenant_id = v_tenant and i.cycle_id is not distinct from v_cycle;
  v_new := greatest(1, least(coalesce(p_new_rank, 1), v_max));
  if v_new = v_old then return; end if;

  perform set_config('pv.rank_internal', 'on', true);
  if v_new < v_old then
    update public.items set stack_rank = stack_rank + 1
     where tenant_id = v_tenant and cycle_id is not distinct from v_cycle
       and stack_rank >= v_new and stack_rank < v_old;
  else
    update public.items set stack_rank = stack_rank - 1
     where tenant_id = v_tenant and cycle_id is not distinct from v_cycle
       and stack_rank > v_old and stack_rank <= v_new;
  end if;
  update public.items set stack_rank = v_new, previous_rank = v_old where id = p_item;
  perform set_config('pv.rank_internal', 'off', true);
end $$;

-- After any delete statement, close the gaps so ranks stay 1..N (one statement, not per row).
create function public.items_compact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('pv.rank_internal', 'on', true);
  with pairs as (select distinct tenant_id, cycle_id from deleted),
  ranked as (
    select i.id, row_number() over (partition by i.tenant_id, i.cycle_id order by i.stack_rank) as rn
      from public.items i
      join pairs p on p.tenant_id = i.tenant_id and p.cycle_id is not distinct from i.cycle_id
  )
  update public.items i set stack_rank = r.rn from ranked r where i.id = r.id and i.stack_rank <> r.rn;
  perform set_config('pv.rank_internal', 'off', true);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: write metadata, audit (one row per changed field), item rules
-- ---------------------------------------------------------------------------
create trigger items_a_defaults before insert on public.items
  for each row execute function public.items_before_insert();
create trigger items_b_meta before insert or update on public.items
  for each row execute function public.set_write_meta();
create trigger items_c_guard before insert or update on public.items
  for each row execute function public.items_guard();
create trigger items_audit after insert or update or delete on public.items
  for each row execute function public.audit_row();
create trigger items_compact after delete on public.items
  referencing old table as deleted for each statement execute function public.items_compact();

create trigger projects_meta before insert or update on public.projects
  for each row execute function public.set_write_meta();
create trigger projects_audit after insert or update or delete on public.projects
  for each row execute function public.audit_row();
create trigger teams_meta before insert or update on public.teams
  for each row execute function public.set_write_meta();
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function public.audit_row();
create trigger item_teams_meta before insert or update on public.item_teams
  for each row execute function public.set_write_meta();
create trigger item_teams_audit after insert or update or delete on public.item_teams
  for each row execute function public.audit_row();
create trigger saved_scopes_meta before insert or update on public.saved_scopes
  for each row execute function public.set_write_meta();
create trigger saved_scopes_audit after insert or update or delete on public.saved_scopes
  for each row execute function public.audit_row();
create trigger saved_scope_projects_meta before insert or update on public.saved_scope_projects
  for each row execute function public.set_write_meta();
create trigger saved_scope_projects_audit after insert or update or delete on public.saved_scope_projects
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- RLS: everyone in the tenant reads; creators and admins write items, scopes and
-- links; only admins write projects and teams.
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.teams enable row level security;
alter table public.items enable row level security;
alter table public.item_teams enable row level security;
alter table public.saved_scopes enable row level security;
alter table public.saved_scope_projects enable row level security;

create policy projects_select on public.projects for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy projects_insert on public.projects for insert to authenticated
  with check (tenant_id = any (array (select public.my_admin_tenant_ids())));
create policy projects_update on public.projects for update to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())))
  with check (tenant_id = any (array (select public.my_admin_tenant_ids())));
create policy projects_delete on public.projects for delete to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));

create policy teams_select on public.teams for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy teams_insert on public.teams for insert to authenticated
  with check (tenant_id = any (array (select public.my_admin_tenant_ids())));
create policy teams_update on public.teams for update to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())))
  with check (tenant_id = any (array (select public.my_admin_tenant_ids())));
create policy teams_delete on public.teams for delete to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));

create policy items_select on public.items for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy items_insert on public.items for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy items_update on public.items for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy items_delete on public.items for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy item_teams_select on public.item_teams for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_teams_insert on public.item_teams for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_teams_delete on public.item_teams for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy saved_scopes_select on public.saved_scopes for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy saved_scopes_insert on public.saved_scopes for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy saved_scopes_update on public.saved_scopes for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy saved_scopes_delete on public.saved_scopes for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy saved_scope_projects_select on public.saved_scope_projects for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy saved_scope_projects_insert on public.saved_scope_projects for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy saved_scope_projects_delete on public.saved_scope_projects for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

-- ---------------------------------------------------------------------------
-- Grants: column level. GitHub-driven columns, key, rank, cycle and tenant are
-- not writable by signed-in users; service_role (sync engine, jobs) keeps all.
-- ---------------------------------------------------------------------------
revoke all on public.projects, public.teams, public.items, public.item_teams,
  public.saved_scopes, public.saved_scope_projects from public, anon, authenticated;

grant select on public.projects, public.teams, public.items, public.item_teams,
  public.saved_scopes, public.saved_scope_projects to authenticated;

grant insert (id, tenant_id, name, default_repo, who_breaks_down) on public.projects to authenticated;
grant update (name, default_repo, who_breaks_down) on public.projects to authenticated;
grant delete on public.projects to authenticated;

grant insert (id, tenant_id, name, focus_factor, split_maintenance, split_bugs, split_new, week_hours, github_team)
  on public.teams to authenticated;
grant update (name, focus_factor, split_maintenance, split_bugs, split_new, week_hours, github_team)
  on public.teams to authenticated;
grant delete on public.teams to authenticated;

grant insert (id, tenant_id, title, summary, value_proposition, target_segments, home_project_id, theme,
  owner_user_id, cycle_id, moscow, horizon, focus_area, value, confidence, size, effort_by_skill, decision,
  start_date, end_date, date_precision, health) on public.items to authenticated;
grant update (title, summary, value_proposition, target_segments, home_project_id, theme, owner_user_id,
  moscow, horizon, focus_area, value, confidence, size, effort_by_skill, decision,
  start_date, end_date, date_precision, health) on public.items to authenticated;
grant delete on public.items to authenticated;

grant insert (id, tenant_id, item_id, team_id) on public.item_teams to authenticated;
grant delete on public.item_teams to authenticated;
grant insert (id, tenant_id, name) on public.saved_scopes to authenticated;
grant update (name) on public.saved_scopes to authenticated;
grant delete on public.saved_scopes to authenticated;
grant insert (id, tenant_id, scope_id, project_id) on public.saved_scope_projects to authenticated;
grant delete on public.saved_scope_projects to authenticated;

-- internal trigger functions are not callable through the API (lesson from 0002)
revoke all on function public.items_before_insert(), public.items_guard(), public.items_compact()
  from public, anon, authenticated;
revoke all on function public.move_item(uuid, int) from public, anon;
grant execute on function public.move_item(uuid, int) to authenticated;
