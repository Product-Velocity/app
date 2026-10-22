-- Tenancy foundation: tenants, tenant_members, audit_log, with RLS.
-- Rules: docs/03-DATA-MODEL.md, CLAUDE.md rules 1, 3, 5.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Write source. Server code sets `app.via` per transaction
-- (select set_config('app.via', 'UI', true)); clients cannot reach this setting.
-- ---------------------------------------------------------------------------
create function public.write_source() returns text
language plpgsql stable set search_path = '' as $$
declare v text := nullif(current_setting('app.via', true), '');
begin
  if v is null then
    return case when auth.uid() is null then 'system' else 'API' end;
  end if;
  if v not in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system') then
    raise exception 'invalid write source: %', v;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system'))
);

-- ---------------------------------------------------------------------------
-- tenant_members: role + separate Approver flag
-- ---------------------------------------------------------------------------
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'commenter', 'creator', 'admin', 'leadership')),
  is_approver boolean not null default false,
  is_service_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, user_id),
  -- CLAUDE.md rule 3: no service account may hold Approver.
  constraint service_account_cannot_approve check (not (is_service_account and is_approver))
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- ---------------------------------------------------------------------------
-- audit_log: append-only (rule 5)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,            -- deliberately no FK: history outlives the tenant row
  entity text not null,
  entity_id uuid,
  field text not null,
  old jsonb,
  new jsonb,
  actor_id uuid,                      -- null = system / service role
  via text not null
    check (via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  at timestamptz not null default now()
);
create index audit_log_tenant_at_idx on public.audit_log (tenant_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create function public.audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- Triggers: write metadata + audit rows (one row per changed field)
-- ---------------------------------------------------------------------------
create function public.set_write_meta() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_via := public.write_source();
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_tenant uuid := (case when tg_table_name = 'tenants' then v_row ->> 'id'
                         else v_row ->> 'tenant_id' end)::uuid;
  k text;
begin
  for k in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new)
    ) s
    where key <> 'updated_at'
  loop
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (v_tenant, tg_table_name, (v_row ->> 'id')::uuid, k, v_old -> k, v_new -> k,
              auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;

create trigger tenants_meta before insert or update on public.tenants
  for each row execute function public.set_write_meta();
create trigger tenants_audit after insert or update or delete on public.tenants
  for each row execute function public.audit_row();

create function public.guard_approver() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.write_source() = 'Claude MCP'
     and new.is_approver
     and (tg_op = 'INSERT' or not old.is_approver) then
    raise exception 'Claude cannot grant the Approver permission';
  end if;
  return new;
end $$;

create trigger tenant_members_meta before insert or update on public.tenant_members
  for each row execute function public.set_write_meta();
create trigger tenant_members_guard_approver before insert or update on public.tenant_members
  for each row execute function public.guard_approver();
create trigger tenant_members_audit after insert or update or delete on public.tenant_members
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies on tenant_members cannot recurse)
-- ---------------------------------------------------------------------------
create function public.is_tenant_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid()
  )
$$;

create function public.is_tenant_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'admin'
  )
$$;

-- Creating a tenant makes the caller its first admin, atomically and audited.
create function public.create_tenant(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.tenants (name) values (p_name) returning id into v_id;
  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.audit_log enable row level security;

create policy tenants_select on public.tenants
  for select to authenticated using (public.is_tenant_member(id));
create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_tenant_admin(id)) with check (public.is_tenant_admin(id));
-- no insert/delete policy: tenants are created via create_tenant() only

create policy tenant_members_select on public.tenant_members
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy tenant_members_insert on public.tenant_members
  for insert to authenticated with check (public.is_tenant_admin(tenant_id));
create policy tenant_members_update on public.tenant_members
  for update to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy tenant_members_delete on public.tenant_members
  for delete to authenticated using (public.is_tenant_admin(tenant_id));

create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Grants: least privilege on top of RLS. service_role keeps full access
-- (it bypasses RLS; audit_log stays append-only through its triggers).
-- ---------------------------------------------------------------------------
revoke all on public.tenants, public.tenant_members, public.audit_log from public, anon, authenticated;
grant select on public.tenants to authenticated;
grant update (name) on public.tenants to authenticated;
grant select, delete on public.tenant_members to authenticated;
grant insert (tenant_id, user_id, role, is_approver, is_service_account)
  on public.tenant_members to authenticated;
grant update (role, is_approver, is_service_account) on public.tenant_members to authenticated;
grant select on public.audit_log to authenticated;

revoke all on function public.write_source(), public.audit_row(), public.set_write_meta(),
  public.guard_approver(), public.audit_log_append_only(),
  public.is_tenant_member(uuid), public.is_tenant_admin(uuid), public.create_tenant(text)
  from public, anon;
grant execute on function public.write_source(), public.is_tenant_member(uuid),
  public.is_tenant_admin(uuid), public.create_tenant(text) to authenticated;

grant execute on function public.write_source() to service_role;
