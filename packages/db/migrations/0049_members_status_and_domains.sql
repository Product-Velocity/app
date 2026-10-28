-- 0049: workspace onboarding, authorized email domains and the unified members grid (issue #216, request R-110; docs/15 section 3b).
--
-- 1. tenants gets its profile (country, currency, time zone) and `allowed_email_domains`. A trigger refuses free-mail providers
--    (anyone can have an address there) and malformed domains. Several workspaces may list the same domain: DNS proof is out of scope,
--    so a first claim must not lock the real owner out (go-live item in docs/14).
-- 2. tenant_members gets `status`: requested | active | paused | revoked ("Invited" is a pending invitation, not a stored status).
--    Only `active` rows grant access. Every helper, policy-backed function and SECURITY DEFINER function that asked "is this person a member"
--    now asks "is this person an ACTIVE member". Status is changed only through set_member_status() (admin, audited), never by a column grant.
-- 3. active_tenant_members is a security_invoker view (RLS still applies as the caller); it replaces the raw table in the membership checks below.
-- 4. request_access_by_domain(): a confirmed email at an authorized domain gets a Requested Access row. It never grants access.
-- 5. members_grid(), set_member_status(), my_access_requests(), tenant_admin_emails() (service role only).

-- ---------------------------------------------------------------------------
-- tenants: profile and authorized domains
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column country text check (country is null or char_length(btrim(country)) between 2 and 80),
  add column currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  add column time_zone text check (time_zone is null or char_length(btrim(time_zone)) between 1 and 64),
  add column allowed_email_domains text[] not null default '{}';

create function public.validate_tenant_domains() returns trigger
language plpgsql set search_path = '' as $$
declare d text;
begin
  if coalesce(cardinality(new.allowed_email_domains), 0) > 20 then
    raise exception 'at most 20 authorized domains' using errcode = 'PV010';
  end if;
  if (select count(distinct x) from unnest(new.allowed_email_domains) x) <> coalesce(cardinality(new.allowed_email_domains), 0) then
    raise exception 'duplicate authorized domain' using errcode = 'PV010';
  end if;
  foreach d in array new.allowed_email_domains loop
    if d is null or d <> lower(btrim(d)) or d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
      raise exception 'not a valid domain: %', d using errcode = 'PV010';
    end if;
    if d = any (array['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','ymail.com',
                      'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net',
                      'mail.com','zoho.com','yandex.com','qq.com','163.com','126.com','fastmail.com','hey.com','tutanota.com','tuta.io']) then
      raise exception 'free email provider: %', d using errcode = 'PV011';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.validate_tenant_domains() from public, anon, authenticated;
create trigger tenants_validate_domains before insert or update of allowed_email_domains on public.tenants
  for each row execute function public.validate_tenant_domains();

grant update (country, currency, time_zone, allowed_email_domains) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- tenant_members: status
-- ---------------------------------------------------------------------------
alter table public.tenant_members
  add column status text not null default 'active' check (status in ('requested', 'active', 'paused', 'revoked')),
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references auth.users (id) on delete set null;
create index tenant_members_tenant_status_idx on public.tenant_members (tenant_id, status);

create view public.active_tenant_members with (security_invoker = true) as
  select * from public.tenant_members where status = 'active';
revoke all on public.active_tenant_members from public, anon;
grant select on public.active_tenant_members to authenticated;

-- RLS helpers: only ACTIVE members count
create or replace function public.is_tenant_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m where m.tenant_id = t and m.user_id = auth.uid() and m.status = 'active')
$$;
create or replace function public.is_tenant_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active')
$$;
create or replace function public.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and status = 'active'
$$;
create or replace function public.my_editor_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and status = 'active' and role in ('creator', 'admin')
$$;
create or replace function public.my_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members where user_id = auth.uid() and status = 'active' and role = 'admin'
$$;
create or replace function public.my_human_admin_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members
  where user_id = auth.uid() and status = 'active' and role = 'admin' and not is_service_account
$$;

-- Members see the active roster; admins also see requested, paused and revoked rows. Nobody sees a non-active row of their own
-- (they learn their state from my_access_requests()), so a paused admin cannot read their way back in.
drop policy tenant_members_select on public.tenant_members;
create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using ((status = 'active' and public.is_tenant_member(tenant_id)) or public.is_tenant_admin(tenant_id));

-- The last ACTIVE admin cannot step down, be paused or be revoked.
create or replace function public.guard_last_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active') then
    perform 1 from public.tenants t where t.id = old.tenant_id for update;
    if found and not exists (
      select 1 from public.tenant_members m
       where m.tenant_id = old.tenant_id and m.role = 'admin' and m.status = 'active' and m.id <> old.id
    ) then
      raise exception 'a tenant must keep at least one admin' using errcode = 'PV003';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- The people list the rest of the app uses (owner pickers and so on): active members only.
create or replace function public.tenant_directory(p_tenant uuid)
returns table (
  member_id uuid, user_id uuid, email text, role text,
  is_approver boolean, is_service_account boolean, joined_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, u.email::text, m.role, m.is_approver, m.is_service_account, m.created_at
    from public.tenant_members m
    join auth.users u on u.id = m.user_id
   where m.tenant_id = p_tenant and m.status = 'active'
     and public.is_tenant_member(p_tenant)
   order by u.email
$$;

-- Accepting an invitation also activates a person who had asked for access (or was paused or revoked): the admin chose to invite them.
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_email text;
  v_confirmed timestamptz;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = auth.uid();

  select * into v_inv from public.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
   for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now()
     or v_confirmed is null
     or lower(v_email) is distinct from v_inv.email then
    raise exception 'invalid or expired invitation' using errcode = 'PV001';
  end if;

  select m.status into v_status from public.tenant_members m
   where m.tenant_id = v_inv.tenant_id and m.user_id = auth.uid();
  if found and v_status = 'active' then
    raise exception 'already a member of this tenant' using errcode = 'PV002';
  elsif found then
    update public.tenant_members
       set status = 'active', role = v_inv.role, is_approver = v_inv.is_approver,
           status_changed_at = now(), status_changed_by = v_inv.created_by
     where tenant_id = v_inv.tenant_id and user_id = auth.uid();
  else
    insert into public.tenant_members (tenant_id, user_id, role, is_approver)
    values (v_inv.tenant_id, auth.uid(), v_inv.role, v_inv.is_approver);
  end if;

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return v_inv.tenant_id;
end $$;

-- ---------------------------------------------------------------------------
-- Creating a workspace with its profile and domains (the first user becomes its Account Admin, as before)
-- ---------------------------------------------------------------------------
create function public.create_tenant(p_name text, p_country text, p_currency text, p_time_zone text, p_domains text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := public.create_tenant(p_name);
  update public.tenants
     set country = nullif(btrim(p_country), ''), currency = nullif(btrim(p_currency), ''),
         time_zone = nullif(btrim(p_time_zone), ''), allowed_email_domains = coalesce(p_domains, '{}')
   where id = v_id;
  return v_id;
end $$;
revoke all on function public.create_tenant(text, text, text, text, text[]) from public, anon;
grant execute on function public.create_tenant(text, text, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Domain-gated sign-up: a confirmed email at an authorized domain gets a Requested Access row. It grants nothing until an admin approves.
-- Returns every workspace where the caller is waiting; `created` is true only for rows made by this call (those notify the admins).
-- ---------------------------------------------------------------------------
create function public.request_access_by_domain()
returns table (tenant_id uuid, tenant_name text, created boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text;
  v_confirmed timestamptz;
  v_domain text;
  t record;
  v_new boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_email is null or v_confirmed is null or position('@' in v_email) = 0 then
    return;
  end if;
  v_domain := lower(split_part(v_email, '@', 2));
  perform set_config('app.via', 'system', true);
  for t in select x.id, x.name from public.tenants x where x.allowed_email_domains @> array[v_domain] order by x.created_at loop
    insert into public.tenant_members (tenant_id, user_id, role, status)
    values (t.id, auth.uid(), 'viewer', 'requested')
    on conflict (tenant_id, user_id) do nothing;
    get diagnostics v_new = row_count;
    if v_new or exists (select 1 from public.tenant_members m where m.tenant_id = t.id and m.user_id = auth.uid() and m.status = 'requested') then
      request_access_by_domain.tenant_id := t.id; request_access_by_domain.tenant_name := t.name; request_access_by_domain.created := v_new;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.request_access_by_domain() from public, anon;
grant execute on function public.request_access_by_domain() to authenticated;

-- What the signed-in person is waiting on or locked out of (the holding screen).
create function public.my_access_requests()
returns table (tenant_id uuid, tenant_name text, status text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.name, m.status, coalesce(m.status_changed_at, m.created_at)
    from public.tenant_members m join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid() and m.status in ('requested', 'paused', 'revoked')
   order by m.created_at
$$;
revoke all on function public.my_access_requests() from public, anon;
grant execute on function public.my_access_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- The unified grid: members of every status plus pending invitations (status 'invited'). Admins only.
-- ---------------------------------------------------------------------------
create function public.members_grid(p_tenant uuid)
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
           m.is_service_account, m.status, m.created_at, u.last_sign_in_at, m.github_username, null::timestamptz, null::text
      from public.tenant_members m join auth.users u on u.id = m.user_id
     where m.tenant_id = p_tenant
    union all
    select null::uuid, i.id, null::uuid, i.email, null::text, i.role, i.is_approver,
           false, 'invited', i.created_at, null::timestamptz, null::text, i.expires_at, i.email_status
      from public.invitations i
     where i.tenant_id = p_tenant and i.accepted_at is null and i.revoked_at is null;
end $$;
revoke all on function public.members_grid(uuid) from public, anon;
grant execute on function public.members_grid(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Batch status change. One row at a time so a refusal (last admin, your own row) does not undo the others; each result says why.
-- Allowed: requested -> active | revoked; active -> paused | revoked; paused -> active | revoked; revoked -> active.
-- ---------------------------------------------------------------------------
create function public.set_member_status(p_ids uuid[], p_status text)
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
end $$;
revoke all on function public.set_member_status(uuid[], text) from public, anon;
grant execute on function public.set_member_status(uuid[], text) to authenticated;

-- Emails of the active human admins, for the access-request notification. Server (service role) only: never exposed to clients.
create function public.tenant_admin_emails(p_tenant uuid) returns setof text
language sql stable security definer set search_path = '' as $$
  select u.email::text from public.tenant_members m join auth.users u on u.id = m.user_id
   where m.tenant_id = p_tenant and m.status = 'active' and m.role = 'admin' and not m.is_service_account and u.email is not null
$$;
revoke all on function public.tenant_admin_emails(uuid) from public, anon, authenticated;
grant execute on function public.tenant_admin_emails(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Membership checks inside the other SECURITY DEFINER / trigger functions now read active_tenant_members.
-- (Generated from the live definitions by replacing public.tenant_members in read-only subqueries; inserts and updates keep the table.)
-- ---------------------------------------------------------------------------
-- delete_items
CREATE OR REPLACE FUNCTION public.delete_items(p_ids uuid[])
 RETURNS TABLE(id uuid, ok boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ok uuid[] := '{}'; v_pt uuid[] := '{}'; v_pc uuid[] := '{}';
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.tenant_id, i.cycle_id, i.created_by, i.deleted_at, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.active_tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
     order by i.tenant_id, i.cycle_id nulls first, q.rid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.deleted_at is not null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'It is already in the Trash.'::text;
    elsif r.role = 'admin' or (r.role = 'creator' and r.created_by = v_uid) then
      v_rok := v_rok || true; v_rreason := v_rreason || null::text;
      v_ok := v_ok || r.rid; v_pt := v_pt || r.tenant_id; v_pc := v_pc || r.cycle_id;
    elsif r.role = 'creator' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only the person who added it or an admin can delete it.'::text;
    else
      v_rok := v_rok || false; v_rreason := v_rreason || 'Your role cannot delete initiatives.'::text;
    end if;
  end loop;

  if cardinality(v_ok) > 0 then
    -- lock each rank list (same key as move_item), then mark and close the gaps in this one transaction
    perform pg_advisory_xact_lock(hashtextextended(t.tenant::text || coalesce(t.cyc::text, ''), 0))
      from (select distinct a as tenant, b as cyc from unnest(v_pt, v_pc) as x(a, b) order by 1, 2) t;
    update public.items i set deleted_at = now(), deleted_by = v_uid where i.id = any (v_ok);
    perform pv_internal.compact_ranks(v_pt, v_pc);
  end if;
  return query select * from unnest(v_rid, v_rok, v_rreason);
end $function$
;

-- discard_new_items
CREATE OR REPLACE FUNCTION public.discard_new_items(p_ids uuid[])
 RETURNS TABLE(id uuid, ok boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ok uuid[] := '{}';
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.created_by, i.created_at, i.deleted_at, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.active_tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role not in ('creator', 'admin') then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.created_by is distinct from v_uid or r.created_at < now() - interval '15 minutes' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only the person who just added it can take it back; use Delete instead.'::text;
    else
      v_rok := v_rok || true; v_rreason := v_rreason || null::text; v_ok := v_ok || r.rid;
    end if;
  end loop;
  if cardinality(v_ok) > 0 then
    delete from public.items i where i.id = any (v_ok);
  end if;
  return query select * from unnest(v_rid, v_rok, v_rreason);
end $function$
;

-- github_apply_pull
CREATE OR REPLACE FUNCTION public.github_apply_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  k text;
  v_old public.items%rowtype;
  v_changed jsonb := '{}'::jsonb;
  v_group text;
  v_date date;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.active_tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can take over text from GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push' and l.issue_number is not null) then
    raise exception 'This item has no GitHub issue that can be synced.' using errcode = 'P0002';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'bad fields' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('initiative_name', 'summary', 'description', 'hypothesis', 'moscow', 'theme', 'end_date', 'effort') then
      raise exception 'The field % cannot be taken over from GitHub.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  if p_fields ? 'initiative_name' and char_length(btrim(p_fields ->> 'initiative_name')) = 0 then
    raise exception 'An initiative needs a name.' using errcode = '22023';
  end if;
  if p_fields ? 'moscow' and (p_fields ->> 'moscow') not in ('Must', 'Should', 'Could') then
    raise exception 'GitHub cannot set MoSCoW to %.', p_fields ->> 'moscow' using errcode = '22023';
  end if;
  if p_fields ? 'effort' and (p_fields ->> 'effort') not in ('XS', 'S', 'M', 'L', 'XL') then
    raise exception 'GitHub cannot set the size to %.', p_fields ->> 'effort' using errcode = '22023';
  end if;
  if p_fields ? 'end_date' then
    begin
      v_date := (p_fields ->> 'end_date')::date;
    exception when others then
      raise exception 'The date % is not valid.', p_fields ->> 'end_date' using errcode = '22023';
    end;
    if (p_fields ->> 'end_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The date % is not valid.', p_fields ->> 'end_date' using errcode = '22023'; end if;
  end if;
  if p_fields ? 'theme' then
    select g.name into v_group from public.item_groups g where g.tenant_id = v_tenant and lower(g.name) = lower(btrim(p_fields ->> 'theme'));
    if v_group is null then raise exception 'The Initiative Group % does not exist in this workspace.', p_fields ->> 'theme' using errcode = '22023'; end if;
  end if;
  select * into v_old from public.items where id = p_item for update;

  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set
    initiative_name = case when p_fields ? 'initiative_name' then left(btrim(p_fields ->> 'initiative_name'), 300) else initiative_name end,
    summary = case when p_fields ? 'summary' then nullif(left(p_fields ->> 'summary', 4000), '') else summary end,
    description = case when p_fields ? 'description' then nullif(left(p_fields ->> 'description', 20000), '') else description end,
    hypothesis = case when p_fields ? 'hypothesis' then nullif(left(p_fields ->> 'hypothesis', 8000), '') else hypothesis end,
    moscow = case when p_fields ? 'moscow' then p_fields ->> 'moscow' else moscow end,
    theme = case when p_fields ? 'theme' then v_group else theme end,
    end_date = case when p_fields ? 'end_date' then v_date else end_date end,
    effort = case when p_fields ? 'effort' then p_fields ->> 'effort' else effort end
  where id = p_item;

  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k
      when 'initiative_name' then v_old.initiative_name when 'summary' then v_old.summary
      when 'description' then v_old.description when 'hypothesis' then v_old.hypothesis
      when 'moscow' then v_old.moscow when 'theme' then v_old.theme
      when 'end_date' then v_old.end_date::text else v_old.effort end);
  end loop;
  if p_base is not null then perform public.github_record_base(p_actor, p_item, p_base); end if;
  return v_changed; -- the values that were replaced, for the undo step
end $function$
;

-- github_pull_assignees
CREATE OR REPLACE FUNCTION public.github_pull_assignees(p_actor uuid, p_item uuid, p_user_ids uuid[], p_base jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_old uuid[];
  v_ids uuid[];
begin
  select tenant_id, assignee_ids into v_tenant, v_old from public.items where id = p_item and deleted_at is null for update;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.active_tenant_members m where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account) then
    raise exception 'Only a creator or admin can take over assignees from GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push' and l.issue_number is not null) then
    raise exception 'This item has no GitHub issue that can be synced.' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into v_ids from unnest(coalesce(p_user_ids, '{}')) as u;
  if cardinality(v_ids) > 10 then raise exception 'At most 10 people can be assigned.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_ids) as u where not exists (select 1 from public.active_tenant_members m where m.tenant_id = v_tenant and m.user_id = u)) then
    raise exception 'Only members of this workspace can be assigned.' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set assignee_ids = v_ids where id = p_item and assignee_ids is distinct from v_ids;
  if p_base is not null then perform public.github_record_base(p_actor, p_item, p_base); end if;
  return v_old; -- what was replaced, for the record
end $function$
;

-- github_record_base
CREATE OR REPLACE FUNCTION public.github_record_base(p_actor uuid, p_item uuid, p_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.active_tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can sync an item with GitHub.' using errcode = '42501';
  end if;
  if p_base is null or jsonb_typeof(p_base) <> 'object' then raise exception 'bad base' using errcode = '22023'; end if;
  update public.item_github_links l
     set sync_base = coalesce(l.sync_base, '{}'::jsonb) || p_base, sync_checked_at = now()
   where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push';
  if not found then raise exception 'This item has no GitHub link that can be synced.' using errcode = 'P0002'; end if;
end $function$
;

-- github_record_project_item
CREATE OR REPLACE FUNCTION public.github_record_project_item(p_actor uuid, p_item uuid, p_project_item_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.active_tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can push an item to GitHub.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_github_links set project_item_id = p_project_item_id where tenant_id = v_tenant and item_id = p_item and mode = 'push';
end $function$
;

-- github_record_push
CREATE OR REPLACE FUNCTION public.github_record_push(p_actor uuid, p_item uuid, p_connection uuid, p_repo text, p_number integer, p_issue_id bigint, p_node_id text, p_url text, p_hash text, p_state text, p_error text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.active_tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can push an item to GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.github_connections c where c.id = p_connection and c.tenant_id = v_tenant and c.state = 'connected') then
    raise exception 'The workspace is not connected to GitHub.' using errcode = '42501';
  end if;
  if p_state not in ('pending', 'synced', 'error') then raise exception 'bad sync state' using errcode = '22023'; end if;
  if exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'follow') then
    raise exception 'This item follows an existing GitHub issue read-only; pushing to it is switched off.' using errcode = 'PV006';
  end if;
  if exists (select 1 from public.github_repositories r where r.tenant_id = v_tenant and r.removed_at is null and r.access = 'read_only' and lower(r.full_name) = lower(p_repo)) then
    raise exception 'The repository % is marked read-only; the app never writes to it.', p_repo using errcode = 'PV007';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who confirmed
  insert into public.item_github_links as l (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, issue_node_id, html_url, sync_state, last_error, last_pushed_hash, last_pushed_at)
  values (v_tenant, p_item, p_connection, p_repo, p_number, p_issue_id, p_node_id, p_url, p_state, left(p_error, 300),
          case when p_state = 'synced' then p_hash end, case when p_state = 'synced' then now() end)
  on conflict (tenant_id, item_id) do update set
    connection_id = excluded.connection_id,
    repo_full_name = excluded.repo_full_name,
    issue_number = coalesce(excluded.issue_number, l.issue_number),
    issue_id = coalesce(excluded.issue_id, l.issue_id),
    issue_node_id = coalesce(excluded.issue_node_id, l.issue_node_id),
    html_url = coalesce(excluded.html_url, l.html_url),
    sync_state = excluded.sync_state,
    last_error = excluded.last_error,
    last_pushed_hash = case when excluded.sync_state = 'synced' then excluded.last_pushed_hash else l.last_pushed_hash end,
    last_pushed_at = case when excluded.sync_state = 'synced' then now() else l.last_pushed_at end
  returning id into v_id;
  -- GitHub may have announced the new issue before this link existed, so it sits in Incoming as "Not pulled": it is this initiative's
  if p_number is not null then
    update public.tracker_issues x set pull_state = 'pulled', item_id = p_item, ignore_reason = null
     where x.connection_id = p_connection and lower(x.repo_full_name) = lower(p_repo) and x.issue_number = p_number
       and (x.pull_state <> 'pulled' or x.item_id is distinct from p_item);
  end if;
  return v_id;
end $function$
;

-- items_guard
CREATE OR REPLACE FUNCTION public.items_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_blocked boolean;
  v_claude boolean := public.write_source() = 'Claude MCP';
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  c text;
  -- the columns behind Decision, Value and the commercial fields (CLAUDE.md rule 3; CLAUDE_FORBIDDEN_FIELDS in packages/domain)
  v_person_only text[] := array[
    'value_12m', 'decision', 'decided_by', 'decision_date', 'value_type', 'value_basis',
    'confidence', 'time_to_first_revenue_months', 'customers_requesting'
  ];
begin
  v_blocked := v_claude
    or exists (
      select 1 from public.active_tenant_members m
       where m.tenant_id = new.tenant_id and m.user_id = auth.uid() and m.is_service_account
    );
  if v_blocked then
    foreach c in array v_person_only loop
      if tg_op = 'INSERT' then
        if v_new -> c is not null and v_new -> c <> 'null'::jsonb then
          raise exception 'Claude and service accounts cannot set Value or Decision' using errcode = 'PV004';
        end if;
      elsif coalesce(v_new -> c, 'null'::jsonb) is distinct from coalesce(v_old -> c, 'null'::jsonb) then
        raise exception 'Claude and service accounts cannot set Stack Rank, Value or Decision' using errcode = 'PV004';
      end if;
    end loop;
    if tg_op = 'UPDATE'
       and new.stack_rank is distinct from old.stack_rank
       and coalesce(current_setting('pv.rank_internal', true), '') <> 'on' then
      raise exception 'Claude and service accounts cannot set Stack Rank, Value or Decision' using errcode = 'PV004';
    end if;
  end if;
  -- only a person accepts a draft (flips ai_draft off)
  if v_claude and tg_op = 'UPDATE' and new.ai_draft is distinct from old.ai_draft then
    raise exception 'Claude cannot accept or reject an AI draft; a person does' using errcode = 'PV004';
  end if;
  return new;
end $function$
;

-- mcp_authorize
CREATE OR REPLACE FUNCTION public.mcp_authorize()
 RETURNS TABLE(status text, connection_id uuid, tenant_id uuid, tenant_name text, role text, client_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  c public.mcp_connections;
  v_role text;
  v_name text;
  v_on boolean;
begin
  if auth.uid() is null or v_client is null then
    return query select 'no_connection'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  select * into c from public.mcp_connections m
   where m.user_id = auth.uid() and m.client_id = v_client
   order by (m.revoked_at is null) desc, m.created_at desc limit 1;
  if not found then
    return query select 'no_connection'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  if c.revoked_at is not null then
    return query select 'revoked'::text, c.id, c.tenant_id, null::text, null::text, c.client_name;
    return;
  end if;
  select t.name, t.claude_enabled into v_name, v_on from public.tenants t where t.id = c.tenant_id;
  select m.role into v_role from public.active_tenant_members m where m.tenant_id = c.tenant_id and m.user_id = auth.uid();
  if v_role is null then
    return query select 'not_member'::text, c.id, c.tenant_id, v_name, null::text, c.client_name;
  elsif not v_on then
    return query select 'workspace_off'::text, c.id, c.tenant_id, v_name, v_role, c.client_name;
  else
    return query select 'ok'::text, c.id, c.tenant_id, v_name, v_role, c.client_name;
  end if;
end $function$
;

-- move_item
CREATE OR REPLACE FUNCTION public.move_item(p_item uuid, p_new_rank integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid; v_cycle uuid; v_old int; v_max int; v_new int;
begin
  select i.tenant_id, i.cycle_id, i.stack_rank into v_tenant, v_cycle, v_old
    from public.items i where i.id = p_item and i.deleted_at is null;
  if v_tenant is null or not exists (
    select 1 from public.active_tenant_members m
     where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.role in ('creator', 'admin')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if public.write_source() = 'Claude MCP' or exists (
    select 1 from public.active_tenant_members m
     where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot set Stack Rank' using errcode = 'PV004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || coalesce(v_cycle::text, ''), 0));
  select i.stack_rank into v_old from public.items i where i.id = p_item;
  select max(i.stack_rank) into v_max from public.items i
   where i.tenant_id = v_tenant and i.cycle_id is not distinct from v_cycle and i.deleted_at is null;
  v_new := greatest(1, least(coalesce(p_new_rank, 1), v_max));
  if v_new = v_old then return; end if;

  perform set_config('pv.rank_internal', 'on', true);
  if v_new < v_old then
    update public.items set stack_rank = stack_rank + 1
     where tenant_id = v_tenant and cycle_id is not distinct from v_cycle and deleted_at is null
       and stack_rank >= v_new and stack_rank < v_old;
  else
    update public.items set stack_rank = stack_rank - 1
     where tenant_id = v_tenant and cycle_id is not distinct from v_cycle and deleted_at is null
       and stack_rank > v_old and stack_rank <= v_new;
  end if;
  update public.items set stack_rank = v_new, previous_rank = v_old where id = p_item;
  perform set_config('pv.rank_internal', 'off', true);
end $function$
;

-- purge_items
CREATE OR REPLACE FUNCTION public.purge_items(p_ids uuid[])
 RETURNS TABLE(id uuid, ok boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ok uuid[] := '{}';
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.deleted_at, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.active_tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.role <> 'admin' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only an admin can delete items forever.'::text;
    elsif r.deleted_at is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only items in the Trash can be deleted forever.'::text;
    else
      v_rok := v_rok || true; v_rreason := v_rreason || null::text; v_ok := v_ok || r.rid;
    end if;
  end loop;
  if cardinality(v_ok) > 0 then
    perform set_config('pv.audit_minimal', 'on', true);
    delete from public.items i where i.id = any (v_ok);
    perform set_config('pv.audit_minimal', 'off', true);
  end if;
  return query select * from unnest(v_rid, v_rok, v_rreason);
end $function$
;

-- restore_items
CREATE OR REPLACE FUNCTION public.restore_items(p_ids uuid[])
 RETURNS TABLE(id uuid, ok boolean, reason text, stack_rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  r record; g record; x record;
  v_rid uuid[] := '{}'; v_rok boolean[] := '{}'; v_rreason text[] := '{}';
  v_ok uuid[] := '{}'; v_pt uuid[] := '{}'; v_pc uuid[] := '{}';
  v_order uuid[]; v_pos int; v_restored uuid[];
begin
  perform pv_internal.refuse_claude();
  for r in
    select q.rid, i.id as item, i.tenant_id, i.cycle_id, i.created_by, i.deleted_at, i.deleted_by, m.role
      from (select distinct u as rid from unnest(p_ids) u) q
      left join public.items i on i.id = q.rid
      left join public.active_tenant_members m on m.tenant_id = i.tenant_id and m.user_id = v_uid
     order by i.tenant_id, q.rid
  loop
    v_rid := v_rid || r.rid;
    if r.item is null or r.role is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'That item does not exist or you cannot change it.'::text;
    elsif r.deleted_at is null then
      v_rok := v_rok || false; v_rreason := v_rreason || 'It is not in the Trash.'::text;
    elsif r.role = 'admin' or (r.role = 'creator' and v_uid in (r.created_by, r.deleted_by)) then
      v_rok := v_rok || true; v_rreason := v_rreason || null::text;
      v_ok := v_ok || r.rid; v_pt := v_pt || r.tenant_id; v_pc := v_pc || r.cycle_id;
    elsif r.role = 'creator' then
      v_rok := v_rok || false; v_rreason := v_rreason || 'Only the person who added or deleted it, or an admin, can restore it.'::text;
    else
      v_rok := v_rok || false; v_rreason := v_rreason || 'Your role cannot restore initiatives.'::text;
    end if;
  end loop;

  for g in select distinct a as tenant, b as cyc from unnest(v_pt, v_pc) as u(a, b) order by 1, 2 loop
    perform pg_advisory_xact_lock(hashtextextended(g.tenant::text || coalesce(g.cyc::text, ''), 0));
    select coalesce(array_agg(i.id order by i.stack_rank), '{}') into v_order
      from public.items i where i.tenant_id = g.tenant and i.cycle_id is not distinct from g.cyc and i.deleted_at is null;
    v_restored := '{}';
    -- oldest rank first, each back at its old place (or the end if the list is now shorter)
    for x in
      select i.id, i.stack_rank from public.items i
       where i.id = any (v_ok) and i.tenant_id = g.tenant and i.cycle_id is not distinct from g.cyc
       order by i.stack_rank, i.id
    loop
      v_pos := least(x.stack_rank, cardinality(v_order) + 1);
      v_order := v_order[1:v_pos - 1] || x.id || v_order[v_pos:];
      v_restored := v_restored || x.id;
    end loop;
    perform set_config('pv.rank_internal', 'on', true);
    update public.items i
       set stack_rank = n.pos::int,
           deleted_at = case when i.id = any (v_restored) then null else i.deleted_at end,
           deleted_by = case when i.id = any (v_restored) then null else i.deleted_by end
      from unnest(v_order) with ordinality as n(item, pos)
     where i.id = n.item and (i.stack_rank <> n.pos or i.id = any (v_restored));
    perform set_config('pv.rank_internal', 'off', true);
  end loop;
  return query
    select u.rid, u.ok, u.reason, i.stack_rank
      from unnest(v_rid, v_rok, v_rreason) as u(rid, ok, reason)
      left join public.items i on i.id = u.rid and u.ok;
end $function$
;

-- set_github_username
CREATE OR REPLACE FUNCTION public.set_github_username(p_tenant uuid, p_user uuid, p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text := nullif(btrim(coalesce(p_username, '')), '');
begin
  if v is not null then v := ltrim(v, '@'); end if;
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not (auth.uid() = p_user or public.is_tenant_admin(p_tenant)) then
    raise exception 'You can set your own GitHub username; an admin can set anyone''s.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.active_tenant_members m where m.tenant_id = p_tenant and m.user_id = p_user) then
    raise exception 'That person is not a member of this workspace.' using errcode = 'P0002';
  end if;
  if v is not null and v !~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$' then
    raise exception 'That is not a GitHub username.' using errcode = '22023';
  end if;
  update public.tenant_members set github_username = v where tenant_id = p_tenant and user_id = p_user;
end $function$
;

-- set_item_assignees
CREATE OR REPLACE FUNCTION public.set_item_assignees(p_item uuid, p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_ids uuid[];
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.active_tenant_members m where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.role in ('creator', 'admin') and not m.is_service_account) then
    raise exception 'Only a creator or admin can change assignees.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into v_ids from unnest(coalesce(p_user_ids, '{}')) as u;
  if cardinality(v_ids) > 10 then raise exception 'At most 10 people can be assigned.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_ids) as u where not exists (select 1 from public.active_tenant_members m where m.tenant_id = v_tenant and m.user_id = u)) then
    raise exception 'Only members of this workspace can be assigned.' using errcode = '22023';
  end if;
  update public.items set assignee_ids = v_ids where id = p_item and assignee_ids is distinct from v_ids;
end $function$
;
