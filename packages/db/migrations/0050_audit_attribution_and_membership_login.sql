-- 0050: audit attribution (who, role, where, batch) and per-membership last login (issue #219, request R-111, phase 0; docs/15 section 6).
--
-- Identity and membership are already separate here: auth.users is the person, tenant_members is the membership (role, Approver, status,
-- dates) and every access check keys on tenant_id. So the "users + memberships split" of the PRD needs no new table; what was missing is
--   1. an audit entry that carries the actor's name, email and role AS THEY WERE at the time of the change (a snapshot, FR-6.5),
--      the project it concerns, the screen it came from and the batch it belongs to (FR-6.2, FR-6.8);
--   2. a last login per membership, not per person (Last Login Date, R-111 section 2);
--   3. the setting "Restrict invites to authorized domains" (section 4.4), default off.

-- ---------------------------------------------------------------------------
-- 1. Audit snapshot
-- ---------------------------------------------------------------------------
alter table public.audit_log
  add column actor_name text,
  add column actor_email text,
  add column actor_role text,                 -- role in this workspace at the time; 'platform_admin' once phase 1 lands
  add column actor_platform_admin boolean not null default false,
  add column project_id uuid,                 -- the project the object belongs to, when it has one
  add column screen text,                     -- tab or screen the change came from, when the app says (GUC app.screen)
  add column batch_id uuid;                   -- changes made by one batch action share it (GUC pv.batch_id, set by the database function)
create index audit_log_tenant_actor_idx on public.audit_log (tenant_id, actor_id, at desc);
create index audit_log_batch_idx on public.audit_log (batch_id) where batch_id is not null;

-- Filled by the database from the real session, never by a client: the columns above are not writable by any role but the trigger.
create function public.audit_log_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u record;
  v_screen text := left(nullif(current_setting('app.screen', true), ''), 40);
begin
  if new.actor_id is not null then
    select au.email::text as email, nullif(btrim(au.raw_user_meta_data ->> 'full_name'), '') as name
      into u from auth.users au where au.id = new.actor_id;
    new.actor_email := u.email;
    new.actor_name := coalesce(u.name, split_part(u.email, '@', 1));
    new.actor_role := (select m.role from public.tenant_members m
                        where m.tenant_id = new.tenant_id and m.user_id = new.actor_id and m.status = 'active');
  end if;
  new.screen := v_screen;
  new.batch_id := nullif(current_setting('pv.batch_id', true), '')::uuid;
  new.project_id := case new.entity
    when 'projects' then new.entity_id
    when 'items' then (select i.home_project_id from public.items i where i.id = new.entity_id)
    else null end;
  return new;
end $$;
revoke all on function public.audit_log_snapshot() from public, anon, authenticated;
create trigger audit_log_snapshot before insert on public.audit_log
  for each row execute function public.audit_log_snapshot();

-- last_login_at changes on every visit; it is not a change somebody made, so it stays out of the audit log.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_tenant uuid := (case when tg_table_name = 'tenants' then v_row ->> 'id'
                         else v_row ->> 'tenant_id' end)::uuid;
  v_minimal boolean := tg_op = 'DELETE' and coalesce(current_setting('pv.audit_minimal', true), '') = 'on';
  k text;
begin
  if v_minimal and tg_table_name <> 'items' then
    return null; -- rows that go with a purged item: the item's own entry says what was removed
  end if;
  for k in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new)
    ) s
    where key not in ('updated_at', 'last_login_at') and (not v_minimal or key in ('item_code', 'initiative_name'))
  loop
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (v_tenant, tg_table_name, (v_row ->> 'id')::uuid, k, v_old -> k, v_new -> k,
              auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Last login per membership
-- ---------------------------------------------------------------------------
alter table public.tenant_members add column last_login_at timestamptz;
-- start from the best information there is: the person's last sign-in, for memberships that grant access
update public.tenant_members m set last_login_at = u.last_sign_in_at
  from auth.users u where u.id = m.user_id and m.status = 'active';

-- Called by the app when a signed-in person opens a workspace. At most one write a minute per membership.
create function public.touch_membership_login(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  update public.tenant_members
     set last_login_at = now()
   where tenant_id = p_tenant and user_id = auth.uid() and status = 'active'
     and (last_login_at is null or last_login_at < now() - interval '1 minute')
$$;
revoke all on function public.touch_membership_login(uuid) from public, anon;
grant execute on function public.touch_membership_login(uuid) to authenticated;

create or replace function public.members_grid(p_tenant uuid)
returns table (
  member_id uuid, invitation_id uuid, user_id uuid, email text, name text, role text, is_approver boolean,
  is_service_account boolean, status text, created_at timestamptz, last_login_at timestamptz,
  github_username text, expires_at timestamptz, email_status text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_tenant_admin(p_tenant) then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
    select m.id, null::uuid, m.user_id, u.email::text, nullif(u.raw_user_meta_data ->> 'full_name', ''), m.role, m.is_approver,
           m.is_service_account, m.status, m.created_at, m.last_login_at, m.github_username, null::timestamptz, null::text
      from public.tenant_members m join auth.users u on u.id = m.user_id
     where m.tenant_id = p_tenant
    union all
    select null::uuid, i.id, null::uuid, i.email, null::text, i.role, i.is_approver,
           false, 'invited', i.created_at, null::timestamptz, null::text, i.expires_at, i.email_status
      from public.invitations i
     where i.tenant_id = p_tenant and i.accepted_at is null and i.revoked_at is null;
end $$;

-- A batch status change is one batch: every member it touches gets an audit entry carrying the same batch id (FR-6.8).
-- The id is a transaction-local setting written here, so a client cannot choose it.
create or replace function public.set_member_status(p_ids uuid[], p_status text)
returns table (member_id uuid, user_id uuid, email text, previous_status text, ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
  m public.tenant_members;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'paused', 'revoked') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  perform set_config('pv.batch_id', gen_random_uuid()::text, true);
  for v_id in select distinct x from unnest(coalesce(p_ids, '{}')) x loop
    member_id := v_id; user_id := null; email := null; previous_status := null; ok := false; reason := null;
    select * into m from public.tenant_members where id = v_id for update;
    if not found or not public.is_tenant_admin(m.tenant_id) then
      reason := 'Not found.'; return next; continue;
    end if;
    user_id := m.user_id; previous_status := m.status;
    select u.email::text into email from auth.users u where u.id = m.user_id;
    if m.is_service_account then
      reason := 'Service accounts are managed elsewhere.';
    elsif m.user_id = auth.uid() then
      reason := 'You cannot change your own status.';
    elsif m.status = p_status then
      reason := 'Already ' || p_status || '.';
    elsif not (   (m.status = 'requested' and p_status in ('active', 'revoked'))
               or (m.status = 'active'    and p_status in ('paused', 'revoked'))
               or (m.status = 'paused'    and p_status in ('active', 'revoked'))
               or (m.status = 'revoked'   and p_status = 'active')) then
      reason := 'A ' || m.status || ' member cannot become ' || p_status || '.';
    else
      begin
        update public.tenant_members
           set status = p_status, status_changed_at = now(), status_changed_by = auth.uid()
         where id = v_id;
        ok := true;
      exception when sqlstate 'PV003' then
        reason := 'A workspace must keep at least one active admin.';
      end;
    end if;
    return next;
  end loop;
  perform set_config('pv.batch_id', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Restrict invites to authorized domains (default off)
-- ---------------------------------------------------------------------------
alter table public.tenants add column restrict_invites_to_domains boolean not null default false;
grant update (restrict_invites_to_domains) on public.tenants to authenticated;

-- Off-domain invitations are refused when the setting is on. (The PRD also allows "a marked guest"; we block, which is the stricter
-- of its two options. Decision in docs/DECISIONS.md.) Resending an existing invitation is not blocked: only new ones are.
create function public.invitations_domain_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tenants;
begin
  select * into t from public.tenants where id = new.tenant_id;
  if t.restrict_invites_to_domains
     and not (lower(split_part(new.email, '@', 2)) = any (t.allowed_email_domains)) then
    raise exception 'this workspace only invites people at its authorized domains' using errcode = 'PV012';
  end if;
  return new;
end $$;
revoke all on function public.invitations_domain_guard() from public, anon, authenticated;
create trigger invitations_domain_guard before insert on public.invitations
  for each row execute function public.invitations_domain_guard();
