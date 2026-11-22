-- All accounts console v2 (platform owner, 2026-11-22; decision docs/decisions/2026-11-22-platform-accounts-console.md).
--
-- 1. Pause access to an account: tenants.suspended_at. A paused account grants its members nothing (the RLS helpers skip it) and every write
--    by a signed-in non-platform user is refused (PV025, a backstop for security-definer functions). Platform admins can still enter it.
--    Service-role jobs (webhooks, sync) are not signed-in users and are not stopped by this release.
-- 2. platform_accounts() grows: company URL, country, created date, items, requested access, pending invitations, last login,
--    Claude/AI agents connected (by name), GitHub and Jira state, paused.
-- 3. platform_account_members() lists the people and pending invitations of an account.
-- 4. The narrow exception to CLAUDE.md rule 10 (Ashu, 2026-11-22): a platform admin may invite people, resend or cancel invitations and
--    pause/resume/revoke a member, ONLY through the functions below (each audited in that account's log and in platform.config_log).
--    Never Approver, never a role change, never a service account. The table triggers stay as they were for every other path.

-- ---------------------------------------------------------------------------
-- 1. Pause
-- ---------------------------------------------------------------------------
alter table public.tenants add column suspended_at timestamptz;

create function public.tenant_is_suspended(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants x where x.id = t and x.suspended_at is not null)
$$;
revoke all on function public.tenant_is_suspended(uuid) from public, anon;
grant execute on function public.tenant_is_suspended(uuid) to authenticated;

-- The access helpers (same shape as 0051) skip a paused account for members; an open platform entry still works.
create or replace function public.is_tenant_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m join public.tenants x on x.id = m.tenant_id
                  where m.tenant_id = t and m.user_id = auth.uid() and m.status = 'active' and x.suspended_at is null)
      or platform.has_entry(auth.uid(), t)
$$;
create or replace function public.is_tenant_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m join public.tenants x on x.id = m.tenant_id
                  where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active' and x.suspended_at is null)
      or platform.has_entry(auth.uid(), t)
$$;
create or replace function public.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.tenant_members m join public.tenants x on x.id = m.tenant_id
   where m.user_id = auth.uid() and m.status = 'active' and x.suspended_at is null
  union
  select platform.entered_tenants(false)
$$;
create or replace function public.my_editor_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.tenant_members m join public.tenants x on x.id = m.tenant_id
   where m.user_id = auth.uid() and m.status = 'active' and m.role in ('creator', 'admin') and x.suspended_at is null
  union
  select platform.entered_tenants(false)
$$;
create or replace function public.my_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.tenant_members m join public.tenants x on x.id = m.tenant_id
   where m.user_id = auth.uid() and m.status = 'active' and m.role = 'admin' and x.suspended_at is null
  union
  select platform.entered_tenants(false)
$$;
create or replace function public.my_human_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.tenant_members m join public.tenants x on x.id = m.tenant_id
   where m.user_id = auth.uid() and m.status = 'active' and m.role = 'admin' and not m.is_service_account and x.suspended_at is null
  union
  select platform.entered_tenants(false)
$$;

-- Backstop: a signed-in person who is not a platform admin cannot write to a paused account, whatever function they go through.
create function platform.suspended_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  v_tenant := (case when tg_table_name = 'tenants' then to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> 'id'
                    else to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> 'tenant_id' end)::uuid;
  -- remembered for the rest of the transaction: bulk writes touch thousands of rows
  if current_setting('pv.tenant_live', true) = v_tenant::text then return case when tg_op = 'DELETE' then old else new end; end if;
  if exists (select 1 from public.tenants t where t.id = v_tenant and t.suspended_at is not null) and not platform.is_admin(auth.uid()) then
    raise exception 'this account is paused' using errcode = 'PV025';
  end if;
  perform set_config('pv.tenant_live', v_tenant::text, true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function platform.suspended_guard() from public, anon, authenticated;
grant execute on function platform.suspended_guard() to service_role;

do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = case when c.relname = 'tenants' then 'id' else 'tenant_id' end and not a.attisdropped)
  loop
    execute format('create trigger b_platform_suspended_guard before insert or update or delete on public.%I
                    for each row execute function platform.suspended_guard()', r.relname);
  end loop;
end $$;

-- A member of a paused account learns it from the holding screen (the account is not in their list any more).
create or replace function public.my_access_requests()
returns table (tenant_id uuid, tenant_name text, status text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.name, m.status, coalesce(m.status_changed_at, m.created_at)
    from public.tenant_members m join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid() and m.status in ('requested', 'paused', 'revoked')
  union all
  select m.tenant_id, t.name, 'account_paused'::text, t.suspended_at
    from public.tenant_members m join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid() and m.status = 'active' and t.suspended_at is not null
   order by 4
$$;

create function public.platform_set_suspended(p_tenant uuid, p_suspend boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old timestamptz;
begin
  perform platform.require_admin();
  select suspended_at into v_old from public.tenants where id = p_tenant;
  if not found then raise exception 'unknown account' using errcode = 'P0002'; end if;
  if (v_old is not null) = p_suspend then return; end if;
  update public.tenants set suspended_at = case when p_suspend then now() else null end where id = p_tenant;
  perform platform.log_config(case when p_suspend then 'account_paused' else 'account_resumed' end, null, p_tenant, null,
                              jsonb_build_object('reason', left(nullif(btrim(p_reason), ''), 500)));
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (p_tenant, 'platform_access', p_tenant, case when p_suspend then 'account_paused' else 'account_resumed' end, null,
          to_jsonb(coalesce(left(nullif(btrim(p_reason), ''), 500), 'no reason given')), auth.uid(), 'UI');
end $$;
revoke all on function public.platform_set_suspended(uuid, boolean, text) from public, anon;
grant execute on function public.platform_set_suspended(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The console list
-- ---------------------------------------------------------------------------
drop function public.platform_accounts(text, integer, integer);
create function public.platform_accounts(p_search text default null, p_limit integer default 500, p_offset integer default 0)
returns table (tenant_id uuid, name text, plan text, owner_email text, owner_name text,
               member_count integer, requested_count integer, invited_count integer, project_count integer, item_count integer,
               last_activity timestamptz, last_login_at timestamptz, access_override text, created_at timestamptz,
               company_url text, country text, claude_enabled boolean, ai_agents jsonb,
               github_state text, jira_state text, suspended_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select t.id, t.name, t.plan,
           (select au.email::text from public.tenant_members m join auth.users au on au.id = m.user_id
             where m.tenant_id = t.id and m.role = 'admin' and m.status = 'active' and not m.is_service_account
             order by m.created_at limit 1),
           (select coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), split_part(au.email, '@', 1))
              from public.tenant_members m join auth.users au on au.id = m.user_id
             where m.tenant_id = t.id and m.role = 'admin' and m.status = 'active' and not m.is_service_account
             order by m.created_at limit 1),
           (select count(*)::int from public.tenant_members m where m.tenant_id = t.id and m.status = 'active' and not m.is_service_account),
           (select count(*)::int from public.tenant_members m where m.tenant_id = t.id and m.status = 'requested'),
           (select count(*)::int from public.invitations i where i.tenant_id = t.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
           (select count(*)::int from public.projects p where p.tenant_id = t.id),
           (select count(*)::int from public.items i where i.tenant_id = t.id),
           (select max(a.at) from public.audit_log a where a.tenant_id = t.id and a.entity <> 'platform_access'),
           (select max(m.last_login_at) from public.tenant_members m where m.tenant_id = t.id and not m.is_service_account),
           (select o.access_level from platform.account_overrides o where o.tenant_id = t.id),
           t.created_at,
           t.company_url, t.country, t.claude_enabled,
           coalesce((select jsonb_agg(jsonb_build_object('name', c.client_name, 'connections', c.n, 'last_used_at', c.last_used, 'calls', c.calls) order by c.last_used desc nulls last, c.client_name)
                       from (select x.client_name, count(*)::int n, max(x.last_used_at) last_used, coalesce(sum(x.call_count), 0)::bigint calls
                               from public.mcp_connections x where x.tenant_id = t.id and x.revoked_at is null group by x.client_name) c), '[]'::jsonb),
           (select g.state from public.github_connections g where g.tenant_id = t.id order by (g.state = 'connected') desc, g.created_at desc limit 1),
           (select j.state from public.jira_connections j where j.tenant_id = t.id order by (j.state = 'connected') desc, j.created_at desc limit 1),
           t.suspended_at
      from public.tenants t
     where p_search is null or btrim(p_search) = '' or t.name ilike '%' || btrim(p_search) || '%' or t.company_url ilike '%' || btrim(p_search) || '%'
     order by t.name
     limit greatest(1, least(coalesce(p_limit, 500), 2000)) offset greatest(0, coalesce(p_offset, 0));
end $$;
revoke all on function public.platform_accounts(text, integer, integer) from public, anon;
grant execute on function public.platform_accounts(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. People and pending invitations of one account (names, roles, states: no roadmap content)
-- ---------------------------------------------------------------------------
create function public.platform_account_members(p_tenant uuid)
returns table (kind text, member_id uuid, invitation_id uuid, email text, name text, role text, is_approver boolean, is_service_account boolean,
               status text, created_at timestamptz, last_login_at timestamptz, expires_at timestamptz, email_status text, ai_agents text[])
language plpgsql security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then raise exception 'unknown account' using errcode = 'P0002'; end if;
  perform platform.log_config('members_viewed', null, p_tenant, null, null);
  return query
    select 'member'::text, m.id, null::uuid, au.email::text,
           coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), split_part(au.email, '@', 1)),
           m.role, m.is_approver, m.is_service_account, m.status, m.created_at, m.last_login_at, null::timestamptz, null::text,
           coalesce((select array_agg(distinct c.client_name order by c.client_name) from public.mcp_connections c
                      where c.tenant_id = m.tenant_id and c.user_id = m.user_id and c.revoked_at is null), '{}'::text[])
      from public.tenant_members m join auth.users au on au.id = m.user_id
     where m.tenant_id = p_tenant
    union all
    select 'invitation'::text, null::uuid, i.id, i.email, null::text, i.role, i.is_approver, false, 'invited'::text, i.created_at, null::timestamptz,
           i.expires_at, i.email_status, '{}'::text[]
      from public.invitations i where i.tenant_id = p_tenant and i.accepted_at is null and i.revoked_at is null
    order by 1, 5, 4;
end $$;
revoke all on function public.platform_account_members(uuid) from public, anon;
grant execute on function public.platform_account_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The narrow exception: member actions by a platform admin
-- ---------------------------------------------------------------------------
-- The table guard still refuses an admin who has entered the account and writes members directly. The functions below set a flag for
-- their own transaction only, after checking: platform admin, recent sign-in, and that platform access to the account is not read-only.
create or replace function platform.membership_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  if auth.uid() is not null
     and platform.has_entry(auth.uid(), v_tenant)
     and current_setting('pv.platform_member_action', true) is distinct from auth.uid()::text
     and not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'platform admins cannot change who has access to a customer account' using errcode = 'PV022';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create function platform.member_action_guard(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_signed timestamptz;
begin
  perform platform.require_admin();
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then raise exception 'unknown account' using errcode = 'P0002'; end if;
  if platform.effective_level(auth.uid(), p_tenant) = 'read_only' then
    raise exception 'platform access to this account is read-only' using errcode = 'PV021';
  end if;
  select au.last_sign_in_at into v_signed from auth.users au where au.id = auth.uid();
  if v_signed is null or v_signed < now() - interval '15 minutes' then
    raise exception 'sign in again to change members' using errcode = 'PV020';
  end if;
  perform set_config('pv.platform_member_action', auth.uid()::text, true);
end $$;

create function platform.log_member_action(p_tenant uuid, p_field text, p_new jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform platform.log_config(p_field, null, p_tenant, null, p_new);
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (p_tenant, 'platform_access', p_tenant, p_field, null, p_new, auth.uid(), 'UI');
end $$;
revoke all on function platform.member_action_guard(uuid), platform.log_member_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function platform.member_action_guard(uuid), platform.log_member_action(uuid, text, jsonb) to service_role;

create function public.platform_invite_member(p_tenant uuid, p_email text, p_role text, p_token_hash text) returns table (invitation_id uuid, tenant_name text)
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email)); v_id uuid;
begin
  perform platform.member_action_guard(p_tenant);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad token.' using errcode = '22023'; end if;
  if exists (select 1 from public.tenant_members m join auth.users au on au.id = m.user_id
              where m.tenant_id = p_tenant and lower(au.email::text) = v_email and m.status in ('active', 'paused', 'requested')) then
    raise exception 'already a member' using errcode = 'PV026';
  end if;
  perform set_config('app.via', 'UI', true);
  insert into public.invitations (tenant_id, email, role, is_approver, token_hash) values (p_tenant, v_email, p_role, false, p_token_hash) returning id into v_id;
  perform platform.log_member_action(p_tenant, 'member_invited', jsonb_build_object('email', v_email, 'role', p_role));
  return query select v_id, (select t.name from public.tenants t where t.id = p_tenant);
end $$;

create function public.platform_reissue_invitation(p_id uuid, p_token_hash text) returns table (email text, role text, tenant_id uuid, tenant_name text)
language plpgsql security definer set search_path = '' as $$
declare i public.invitations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad token.' using errcode = '22023'; end if;
  select * into i from public.invitations where id = p_id and accepted_at is null and revoked_at is null for update;
  if not found then raise exception 'This invitation is already used or revoked.' using errcode = '22023'; end if;
  perform platform.member_action_guard(i.tenant_id);
  perform set_config('app.via', 'UI', true);
  update public.invitations set token_hash = p_token_hash, expires_at = now() + interval '7 days',
         email_status = 'not_sent', email_error = null, email_provider_id = null where id = p_id;
  perform platform.log_member_action(i.tenant_id, 'invitation_renewed', jsonb_build_object('email', i.email));
  return query select i.email, i.role, i.tenant_id, (select t.name from public.tenants t where t.id = i.tenant_id);
end $$;

create function public.platform_cancel_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invitations%rowtype;
begin
  select * into i from public.invitations where id = p_id and accepted_at is null and revoked_at is null for update;
  if not found then raise exception 'This invitation is already used or revoked.' using errcode = '22023'; end if;
  perform platform.member_action_guard(i.tenant_id);
  perform set_config('app.via', 'UI', true);
  update public.invitations set revoked_at = now() where id = p_id;
  perform platform.log_member_action(i.tenant_id, 'invitation_cancelled', jsonb_build_object('email', i.email));
end $$;

-- Same moves as set_member_status (docs/15 section 3.3); the last active admin is protected by the existing trigger (PV003).
create function public.platform_set_member_status(p_member uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.tenant_members%rowtype;
begin
  if p_status is null or p_status not in ('active', 'paused', 'revoked') then raise exception 'invalid status' using errcode = '22023'; end if;
  select * into m from public.tenant_members where id = p_member for update;
  if not found then raise exception 'unknown member' using errcode = 'P0002'; end if;
  perform platform.member_action_guard(m.tenant_id);
  if m.is_service_account then raise exception 'service accounts are managed elsewhere' using errcode = 'PV027'; end if;
  if not (   (m.status = 'requested' and p_status in ('active', 'revoked'))
          or (m.status = 'active'    and p_status in ('paused', 'revoked'))
          or (m.status = 'paused'    and p_status in ('active', 'revoked'))
          or (m.status = 'revoked'   and p_status = 'active')) then
    raise exception 'that status change is not allowed' using errcode = 'PV027';
  end if;
  perform set_config('app.via', 'UI', true);
  update public.tenant_members set status = p_status, status_changed_at = now(), status_changed_by = auth.uid() where id = p_member;
  perform platform.log_member_action(m.tenant_id, 'member_status', jsonb_build_object('member', p_member, 'from', m.status, 'to', p_status));
end $$;

revoke all on function public.platform_invite_member(uuid, text, text, text), public.platform_reissue_invitation(uuid, text),
  public.platform_cancel_invitation(uuid), public.platform_set_member_status(uuid, text) from public, anon;
grant execute on function public.platform_invite_member(uuid, text, text, text), public.platform_reissue_invitation(uuid, text),
  public.platform_cancel_invitation(uuid), public.platform_set_member_status(uuid, text) to authenticated;

-- An action by a platform admin who is not a member is marked as theirs in the account's audit log even without an open entry.
create or replace function public.audit_log_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u record;
  v_screen text := coalesce(nullif(current_setting('app.screen', true), ''),
                            nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-pv-screen', ''));
  v_member text;
begin
  if new.actor_id is not null then
    select au.email::text as email, nullif(btrim(au.raw_user_meta_data ->> 'full_name'), '') as name
      into u from auth.users au where au.id = new.actor_id;
    new.actor_email := u.email;
    new.actor_name := coalesce(u.name, split_part(u.email, '@', 1));
    v_member := (select m.role from public.tenant_members m
                  where m.tenant_id = new.tenant_id and m.user_id = new.actor_id and m.status = 'active');
    if v_member is null and (platform.has_entry(new.actor_id, new.tenant_id) or platform.is_admin(new.actor_id)) then
      new.actor_role := 'platform_admin';
      new.actor_platform_admin := true;
    else
      new.actor_role := v_member;
    end if;
  end if;
  new.screen := case when v_screen ~ '^[a-z0-9_-]{1,30}$' then v_screen else null end;
  new.batch_id := nullif(current_setting('pv.batch_id', true), '')::uuid;
  new.project_id := case new.entity
    when 'projects' then new.entity_id
    when 'items' then (select i.home_project_id from public.items i where i.id = new.entity_id)
    else null end;
  return new;
end $$;
