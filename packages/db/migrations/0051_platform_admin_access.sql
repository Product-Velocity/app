-- 0051: platform admin access (issue #219, request R-111, phase 1; docs/15 sections 5 and 5b).
--
-- A platform admin is NOT a member of any workspace. They get access by ENTERING an account: a logged, time-boxed row in
-- platform.entries. Every access helper (is_tenant_member, my_tenant_ids and the rest) also honours an active entry, so RLS stays keyed on
-- tenant_id and no service-role bypass exists (FR-5.1). Nobody else's access changes: without a membership or an entry, a user sees nothing
-- (FR-5.3, tested with two tenants).
--
-- Access level (FR-2.4 to FR-2.6): read_write by default; read_only can be set platform-wide, per admin (overrides the default) and per
-- account (can only restrict). The effective level is computed on every statement, so switching to read-only takes effect at once, and a
-- BEFORE trigger on every tenant table refuses writes in read-only mode on the server, whatever the UI shows.
--
-- Carve-outs kept from docs/15 section 5.5 (CLAUDE.md rule 10): a platform admin never holds Approver, cannot change who is a member, a role
-- or an Approver flag, and cannot read secrets or send. Reads and writes of roadmap data are what the level controls.

create schema if not exists platform;
revoke all on schema platform from public, anon, authenticated;
grant usage on schema platform to service_role;

-- ---------------------------------------------------------------------------
-- Tables (not exposed through the API: no grants to anon or authenticated)
-- ---------------------------------------------------------------------------
create table platform.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active boolean not null default true,
  access_level text check (access_level in ('read_write', 'read_only')),   -- null = follow the platform default (FR-2.5)
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table platform.settings (
  id boolean primary key default true check (id),                          -- one row
  default_access_level text not null default 'read_write' check (default_access_level in ('read_write', 'read_only')),
  entry_hours integer not null default 8 check (entry_hours between 1 and 24)
);
insert into platform.settings default values;

create table platform.account_overrides (                                    -- an account can only be restricted (FR-2.5)
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  access_level text not null check (access_level = 'read_only'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table platform.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  left_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 500)
);
create unique index platform_entries_one_open_per_admin on platform.entries (user_id) where left_at is null;
create index platform_entries_tenant_idx on platform.entries (tenant_id);

create table platform.config_log (                                          -- configuration changes (FR-2.7); append-only like audit_log
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid, actor_name text, actor_email text,
  field text not null, target_user uuid, target_tenant uuid,
  old jsonb, new jsonb
);
create trigger config_log_append_only before update or delete on platform.config_log
  for each row execute function public.audit_log_append_only();
create trigger config_log_no_truncate before truncate on platform.config_log
  for each statement execute function public.audit_log_append_only();

revoke all on all tables in schema platform from public, anon, authenticated;
grant all on all tables in schema platform to service_role;

-- ---------------------------------------------------------------------------
-- tenants.plan: shown in the All accounts console (FR-2.2). Billing comes later; for now a label that only platform admins set.
-- ---------------------------------------------------------------------------
alter table public.tenants add column plan text not null default 'Trial' check (char_length(btrim(plan)) between 1 and 40);

-- ---------------------------------------------------------------------------
-- Internal helpers (security definer, in the platform schema)
-- ---------------------------------------------------------------------------
create function platform.is_admin(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from platform.admins a where a.user_id = u and a.active)
$$;

-- 'read_write' or 'read_only' for this admin in this account right now
create function platform.effective_level(u uuid, t uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(a.access_level, s.default_access_level) = 'read_only' or o.tenant_id is not null
              then 'read_only' else 'read_write' end
    from platform.settings s
    left join platform.admins a on a.user_id = u and a.active
    left join platform.account_overrides o on o.tenant_id = t
$$;

-- the admin's open, unexpired entry into this account, if any
create function platform.has_entry(u uuid, t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from platform.entries e join platform.admins a on a.user_id = e.user_id and a.active
     where e.user_id = u and e.tenant_id = t and e.left_at is null and e.expires_at > now())
$$;
create function platform.has_entry_rw(u uuid, t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select platform.has_entry(u, t) and platform.effective_level(u, t) = 'read_write'
$$;

create function platform.entered_tenants(rw_only boolean) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.tenant_id from platform.entries e join platform.admins a on a.user_id = e.user_id and a.active
   where e.user_id = auth.uid() and e.left_at is null and e.expires_at > now()
     and (not rw_only or platform.effective_level(e.user_id, e.tenant_id) = 'read_write')
$$;

revoke all on all functions in schema platform from public, anon, authenticated;
grant execute on all functions in schema platform to service_role;

-- ---------------------------------------------------------------------------
-- The access helpers now also honour an active entry. Same names and meaning, so no policy changes.
-- An entry counts as editor and admin at EITHER level: the level is enforced by platform.readonly_guard() below, which fails loudly with
-- PV021 (RLS alone would silently skip rows on update and delete). A test proves every tenant table carries that guard.
-- (The helpers run as the table owner; the platform functions are reached through them, never granted to API roles.)
-- ---------------------------------------------------------------------------
create or replace function public.is_tenant_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m where m.tenant_id = t and m.user_id = auth.uid() and m.status = 'active')
      or platform.has_entry(auth.uid(), t)
$$;
create or replace function public.is_tenant_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active')
      or platform.has_entry(auth.uid(), t)
$$;
create or replace function public.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and status = 'active'
  union
  select platform.entered_tenants(false)
$$;
create or replace function public.my_editor_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and status = 'active' and role in ('creator', 'admin')
  union
  select platform.entered_tenants(false)
$$;
create or replace function public.my_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and status = 'active' and role = 'admin'
  union
  select platform.entered_tenants(false)
$$;
create or replace function public.my_human_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members
   where user_id = auth.uid() and status = 'active' and role = 'admin' and not is_service_account
  union
  select platform.entered_tenants(false)
$$;

-- ---------------------------------------------------------------------------
-- Server-side enforcement (FR-2.6) and the carve-outs
-- ---------------------------------------------------------------------------
-- 1. Read-only: any write to a tenant table by a platform admin acting as a platform admin in read-only mode is refused.
--    "Acting as a platform admin" = has an entry and is not also an active member (members keep their own rights).
create function platform.readonly_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_tenant uuid := (case when tg_table_name = 'tenants' then v_row ->> 'id' else v_row ->> 'tenant_id' end)::uuid;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  -- fast path for the 99.99% of writers who have no entry: remember that for the rest of the transaction (bulk deletes touch thousands of rows)
  if current_setting('pv.no_platform_entry', true) = auth.uid()::text then return case when tg_op = 'DELETE' then old else new end; end if;
  if not exists (select 1 from platform.entries e where e.user_id = auth.uid() and e.left_at is null) then
    perform set_config('pv.no_platform_entry', auth.uid()::text, true);
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if platform.has_entry(auth.uid(), v_tenant)
     and platform.effective_level(auth.uid(), v_tenant) = 'read_only'
     and not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'platform access to this account is read-only' using errcode = 'PV021';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- 2. Membership is the customer's own business: a platform admin who is not a member cannot add, remove or change members, roles,
--    Approver flags or statuses, or accept invitations on someone's behalf (docs/15 section 5.5).
create function platform.membership_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  if auth.uid() is not null
     and platform.has_entry(auth.uid(), v_tenant)
     and not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'platform admins cannot change who has access to a customer account' using errcode = 'PV022';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger tenant_members_platform_guard before insert or update or delete on public.tenant_members
  for each row execute function platform.membership_guard();
create trigger invitations_platform_guard before insert or update or delete on public.invitations
  for each row execute function platform.membership_guard();

-- the read-only guard goes on every table that carries a tenant (audit_log is written by the database itself and stays out)
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = case when c.relname = 'tenants' then 'id' else 'tenant_id' end and not a.attisdropped)
  loop
    execute format('create trigger a_platform_readonly_guard before insert or update or delete on public.%I
                    for each row execute function platform.readonly_guard()', r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Audit snapshot: an action taken through an entry is marked as a platform admin's (FR-6.3)
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u record;
  v_screen text := left(nullif(current_setting('app.screen', true), ''), 40);
  v_member text;
begin
  if new.actor_id is not null then
    select au.email::text as email, nullif(btrim(au.raw_user_meta_data ->> 'full_name'), '') as name
      into u from auth.users au where au.id = new.actor_id;
    new.actor_email := u.email;
    new.actor_name := coalesce(u.name, split_part(u.email, '@', 1));
    v_member := (select m.role from public.tenant_members m
                  where m.tenant_id = new.tenant_id and m.user_id = new.actor_id and m.status = 'active');
    if v_member is null and platform.has_entry(new.actor_id, new.tenant_id) then
      new.actor_role := 'platform_admin';
      new.actor_platform_admin := true;
    else
      new.actor_role := v_member;
    end if;
  end if;
  new.screen := v_screen;
  new.batch_id := nullif(current_setting('pv.batch_id', true), '')::uuid;
  new.project_id := case new.entity
    when 'projects' then new.entity_id
    when 'items' then (select i.home_project_id from public.items i where i.id = new.entity_id)
    else null end;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Functions the app calls (security definer; each checks that the caller is an active platform admin)
-- ---------------------------------------------------------------------------
create function platform.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not platform.is_admin(auth.uid()) then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
end $$;

create function platform.log_config(p_field text, p_target_user uuid, p_target_tenant uuid, p_old jsonb, p_new jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u record;
begin
  select au.email::text as email, coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), split_part(au.email, '@', 1)) as name
    into u from auth.users au where au.id = auth.uid();
  insert into platform.config_log (actor_id, actor_name, actor_email, field, target_user, target_tenant, old, new)
  values (auth.uid(), u.name, u.email, p_field, p_target_user, p_target_tenant, p_old, p_new);
end $$;

create function public.platform_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and platform.is_admin(auth.uid())
$$;

-- Enter an account. Writing mode needs a sign-in within the last 15 minutes (FR-5.2: re-authentication). One open entry per admin.
create function public.platform_enter_account(p_tenant uuid, p_reason text default null) returns table (entry_id uuid, access_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_level text; v_hours integer; v_signed timestamptz; v_id uuid; v_exp timestamptz; v_prev record;
begin
  perform platform.require_admin();
  perform set_config('pv.no_platform_entry', '', true);
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'unknown account' using errcode = 'P0002';
  end if;
  v_level := platform.effective_level(auth.uid(), p_tenant);
  select au.last_sign_in_at into v_signed from auth.users au where au.id = auth.uid();
  if v_level = 'read_write' and (v_signed is null or v_signed < now() - interval '15 minutes') then
    raise exception 'sign in again to enter this account with write access' using errcode = 'PV020';
  end if;
  select s.entry_hours into v_hours from platform.settings s;
  -- leaving the previous account is logged in that account too
  for v_prev in select e.id, e.tenant_id from platform.entries e where e.user_id = auth.uid() and e.left_at is null loop
    insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
    values (v_prev.tenant_id, 'platform_access', v_prev.id, 'left', null, to_jsonb('switched account'::text), auth.uid(), 'UI');
    update platform.entries set left_at = now() where id = v_prev.id;
  end loop;
  v_exp := now() + make_interval(hours => v_hours);
  insert into platform.entries (user_id, tenant_id, expires_at, reason) values (auth.uid(), p_tenant, v_exp, left(p_reason, 500)) returning id into v_id;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (p_tenant, 'platform_access', v_id, 'entered', null, jsonb_build_object('access_level', v_level, 'reason', left(p_reason, 500)), auth.uid(), 'UI');
  return query select v_id, v_level, v_exp;
end $$;

create function public.platform_leave_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_prev record;
begin
  for v_prev in select e.id, e.tenant_id from platform.entries e where e.user_id = auth.uid() and e.left_at is null loop
    insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
    values (v_prev.tenant_id, 'platform_access', v_prev.id, 'left', null, to_jsonb('left'::text), auth.uid(), 'UI');
    update platform.entries set left_at = now() where id = v_prev.id;
  end loop;
end $$;

-- What the banner shows (FR-2.3): the caller's open entry, with the name and email to display. No row when not inside an account.
create function public.platform_current_entry()
returns table (tenant_id uuid, tenant_name text, access_level text, expires_at timestamptz, admin_name text, admin_email text)
language sql stable security definer set search_path = '' as $$
  select e.tenant_id, t.name, platform.effective_level(e.user_id, e.tenant_id), e.expires_at,
         coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), split_part(au.email, '@', 1)), au.email::text
    from platform.entries e
    join public.tenants t on t.id = e.tenant_id
    join auth.users au on au.id = e.user_id
   where e.user_id = auth.uid() and e.left_at is null and e.expires_at > now() and platform.is_admin(e.user_id)
$$;

-- The All accounts console (FR-2.2). Platform admins only; search by account name.
create function public.platform_accounts(p_search text default null, p_limit integer default 100, p_offset integer default 0)
returns table (tenant_id uuid, name text, plan text, owner_email text, member_count integer, project_count integer,
               last_activity timestamptz, access_override text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select t.id, t.name, t.plan,
           (select au.email::text from public.tenant_members m join auth.users au on au.id = m.user_id
             where m.tenant_id = t.id and m.role = 'admin' and m.status = 'active' and not m.is_service_account
             order by m.created_at limit 1),
           (select count(*)::int from public.tenant_members m where m.tenant_id = t.id and m.status = 'active' and not m.is_service_account),
           (select count(*)::int from public.projects p where p.tenant_id = t.id),
           (select max(a.at) from public.audit_log a where a.tenant_id = t.id and a.entity <> 'platform_access'),
           (select o.access_level from platform.account_overrides o where o.tenant_id = t.id),
           t.created_at
      from public.tenants t
     where p_search is null or btrim(p_search) = '' or t.name ilike '%' || btrim(p_search) || '%'
     order by t.name
     limit greatest(1, least(coalesce(p_limit, 100), 500)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- The accounts the switcher offers a platform admin who is searching (name only; the full console is the list above).
create function public.platform_set_plan(p_tenant uuid, p_plan text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform platform.require_admin();
  select plan into v_old from public.tenants where id = p_tenant;
  if not found then raise exception 'unknown account' using errcode = 'P0002'; end if;
  update public.tenants set plan = btrim(p_plan) where id = p_tenant;
  perform platform.log_config('plan', null, p_tenant, to_jsonb(v_old), to_jsonb(btrim(p_plan)));
end $$;

-- Access configuration (FR-2.5). Each change is written to platform.config_log (FR-2.7); account-level changes also to that account's audit log.
create function public.platform_config()
returns table (default_access_level text, entry_hours integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query select s.default_access_level, s.entry_hours from platform.settings s;
end $$;

create function public.platform_admin_list()
returns table (user_id uuid, email text, name text, active boolean, access_level text, effective_level text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select a.user_id, au.email::text, coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), split_part(au.email, '@', 1)),
           a.active, a.access_level,
           case when coalesce(a.access_level, s.default_access_level) = 'read_only' then 'read_only' else 'read_write' end,
           a.created_at
      from platform.admins a join auth.users au on au.id = a.user_id cross join platform.settings s
     order by au.email;
end $$;

create function public.platform_set_default_level(p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform platform.require_admin();
  if p_level not in ('read_write', 'read_only') then raise exception 'invalid access level' using errcode = '22023'; end if;
  select default_access_level into v_old from platform.settings;
  update platform.settings set default_access_level = p_level;
  perform platform.log_config('default_access_level', null, null, to_jsonb(v_old), to_jsonb(p_level));
end $$;

create function public.platform_set_admin_level(p_user uuid, p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform platform.require_admin();
  if p_level is not null and p_level not in ('read_write', 'read_only') then raise exception 'invalid access level' using errcode = '22023'; end if;
  select access_level into v_old from platform.admins where user_id = p_user;
  if not found then raise exception 'not a platform admin' using errcode = 'P0002'; end if;
  update platform.admins set access_level = p_level where user_id = p_user;
  perform platform.log_config('admin_access_level', p_user, null, to_jsonb(v_old), to_jsonb(p_level));
end $$;

create function public.platform_set_account_level(p_tenant uuid, p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform platform.require_admin();
  if p_level is not null and p_level <> 'read_only' then raise exception 'an account can only be restricted to read_only' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then raise exception 'unknown account' using errcode = 'P0002'; end if;
  select access_level into v_old from platform.account_overrides where tenant_id = p_tenant;
  if p_level is null then
    delete from platform.account_overrides where tenant_id = p_tenant;
  else
    insert into platform.account_overrides (tenant_id, access_level, created_by) values (p_tenant, p_level, auth.uid())
    on conflict (tenant_id) do update set access_level = excluded.access_level;
  end if;
  perform platform.log_config('account_access_level', null, p_tenant, to_jsonb(v_old), to_jsonb(p_level));
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (p_tenant, 'platform_access', p_tenant, 'account_access_level', to_jsonb(v_old), to_jsonb(p_level), auth.uid(), 'UI');
end $$;

-- Grant or remove platform admin. Only an existing platform admin can; the first one is created with the service role (docs/14).
create function public.platform_set_admin(p_email text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform platform.require_admin();
  select au.id into v_user from auth.users au where lower(au.email) = lower(btrim(p_email)) and au.email_confirmed_at is not null;
  if v_user is null then raise exception 'no confirmed account with that email' using errcode = 'P0002'; end if;
  if v_user = auth.uid() and not p_active then raise exception 'you cannot remove yourself' using errcode = 'PV023'; end if;
  insert into platform.admins (user_id, active, created_by) values (v_user, p_active, auth.uid())
  on conflict (user_id) do update set active = excluded.active;
  perform platform.log_config('platform_admin', v_user, null, null, to_jsonb(p_active));
  if not p_active then
    update platform.entries set left_at = now() where user_id = v_user and left_at is null;
  end if;
end $$;

-- The audit log across all accounts (FR-6.6) and the configuration log (FR-2.7).
create function public.platform_audit_search(
  p_tenant uuid default null, p_actor text default null, p_field text default null, p_project uuid default null,
  p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 200, p_before bigint default null)
returns setof public.audit_log
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select a.* from public.audit_log a
     where (p_tenant is null or a.tenant_id = p_tenant)
       and (p_actor is null or a.actor_name ilike '%' || p_actor || '%' or a.actor_email ilike '%' || p_actor || '%')
       and (p_field is null or a.field = p_field)
       and (p_project is null or a.project_id = p_project)
       and (p_from is null or a.at >= p_from) and (p_to is null or a.at < p_to)
       and (p_before is null or a.id < p_before)
     order by a.id desc
     limit greatest(1, least(coalesce(p_limit, 200), 5000));
end $$;

create function public.platform_config_log(p_limit integer default 100)
returns setof platform.config_log
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query select * from platform.config_log order by id desc limit greatest(1, least(coalesce(p_limit, 100), 1000));
end $$;

revoke all on function
  public.platform_is_admin(), public.platform_enter_account(uuid, text), public.platform_leave_account(), public.platform_current_entry(),
  public.platform_accounts(text, integer, integer), public.platform_set_plan(uuid, text), public.platform_config(), public.platform_admin_list(),
  public.platform_set_default_level(text), public.platform_set_admin_level(uuid, text), public.platform_set_account_level(uuid, text),
  public.platform_set_admin(text, boolean),
  public.platform_audit_search(uuid, text, text, uuid, timestamptz, timestamptz, integer, bigint), public.platform_config_log(integer)
  from public, anon;
grant execute on function
  public.platform_is_admin(), public.platform_enter_account(uuid, text), public.platform_leave_account(), public.platform_current_entry(),
  public.platform_accounts(text, integer, integer), public.platform_set_plan(uuid, text), public.platform_config(), public.platform_admin_list(),
  public.platform_set_default_level(text), public.platform_set_admin_level(uuid, text), public.platform_set_account_level(uuid, text),
  public.platform_set_admin(text, boolean),
  public.platform_audit_search(uuid, text, text, uuid, timestamptz, timestamptz, integer, bigint), public.platform_config_log(integer)
  to authenticated;

-- customers may not change the label that platform admins set
revoke update (plan) on public.tenants from authenticated;
