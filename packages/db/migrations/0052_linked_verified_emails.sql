-- 0052: linked verified emails and multi-account sign-in (issue #219, request R-111, phases 2 and 3).
--
-- One person = one auth.users row (the identity) with any number of tenant_members rows (the memberships; migration 0001 and 0049), so
-- "one login, several accounts" (FR-3) already holds: accept_invitation() attaches a membership to the signed-in user. This migration adds
-- what was missing:
--   * identity.emails: secondary emails, each verified by a 6-digit code before it counts (FR-4.1). An address is verified for ONE person
--     only (FR-4.5) and never equals another person's primary email.
--   * domain matching runs against every verified email (FR-4.3); a membership created that way remembers which email it came from.
--   * removing a linked email sends memberships that came only through it back to "Requested Access" for the admin to review (FR-4.6).
--   * invitations can be accepted with any verified email of the person (FR-3.2, FR-4.2).
--   * the notification email is chosen by the person (FR-4.4).
-- The table lives in its own schema, reached only through the functions below: nothing in it is readable through the API.

create schema if not exists identity;
revoke all on schema identity from public, anon, authenticated;
grant usage on schema identity to service_role;

create table identity.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  verified_at timestamptz,
  code_hash text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  codes_sent integer not null default 0,
  code_sent_at timestamptz,
  use_for_notifications boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, email)
);
-- an address is verified for one person only
create unique index identity_emails_verified_unique on identity.emails (email) where verified_at is not null;
create unique index identity_emails_one_notification on identity.emails (user_id) where use_for_notifications;
create index identity_emails_email_idx on identity.emails (email);
alter table identity.emails enable row level security;   -- no policies: API roles read nothing; the definer functions below do the work
revoke all on identity.emails from public, anon, authenticated;
grant all on identity.emails to service_role;

-- where a membership came from, so that removing the email can send it back for review (FR-4.6)
alter table public.tenant_members add column requested_via_email text;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- every address that identifies this person: the sign-in email (if confirmed) plus verified linked emails
create function identity.verified_emails(u uuid) returns setof text
language sql stable security definer set search_path = '' as $$
  select lower(au.email)::text from auth.users au where au.id = u and au.email is not null and au.email_confirmed_at is not null
  union
  select e.email from identity.emails e where e.user_id = u and e.verified_at is not null
$$;

-- who a person's notification email goes to
create function identity.notification_email(u uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select e.email from identity.emails e where e.user_id = u and e.verified_at is not null and e.use_for_notifications),
    (select au.email::text from auth.users au where au.id = u))
$$;

revoke all on all functions in schema identity from public, anon, authenticated;
grant execute on all functions in schema identity to service_role;

-- ---------------------------------------------------------------------------
-- Link an email: start (the server sends the code), verify, remove, choose the notification email, list
-- ---------------------------------------------------------------------------
-- The server makes the code and emails it; the database keeps only its hash. `send` is false when the address cannot be linked to this
-- person (another person has it verified, or it is another person's sign-in email): the caller answers the same way in both cases, so the
-- form does not reveal who has which address.
create function public.link_email_start(p_email text, p_code_hash text) returns table (send boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row identity.emails;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'not a valid email address' using errcode = '22023';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code' using errcode = '22023'; end if;
  if (select count(*) from identity.emails where user_id = auth.uid()) >= 10 then
    raise exception 'at most 10 linked emails' using errcode = 'PV030';
  end if;
  -- already this person's own sign-in email or already verified for them: nothing to do
  if v_email in (select identity.verified_emails(auth.uid())) then
    raise exception 'that address is already on your account' using errcode = 'PV031';
  end if;
  select * into v_row from identity.emails where user_id = auth.uid() and email = v_email for update;
  if found and v_row.code_sent_at > now() - interval '60 seconds' then
    raise exception 'wait a minute before asking for another code' using errcode = 'PV032';
  end if;
  if found and v_row.code_sent_at > now() - interval '1 hour' and v_row.codes_sent >= 5 then
    raise exception 'too many codes for this address; try again later' using errcode = 'PV032';
  end if;
  if exists (select 1 from identity.emails e where e.email = v_email and e.verified_at is not null and e.user_id <> auth.uid())
     or exists (select 1 from auth.users au where lower(au.email) = v_email and au.id <> auth.uid()) then
    return query select false;   -- looks the same from outside; nothing is stored, nothing is sent
    return;
  end if;
  insert into identity.emails (user_id, email, code_hash, code_expires_at, codes_sent, code_sent_at)
  values (auth.uid(), v_email, p_code_hash, now() + interval '15 minutes', 1, now())
  on conflict (user_id, email) do update
     set code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at, code_attempts = 0,
         codes_sent = case when identity.emails.code_sent_at > now() - interval '1 hour' then identity.emails.codes_sent + 1 else 1 end,
         code_sent_at = now();
  return query select true;
end $$;

-- Checks the code. A wrong or expired code returns ok = false (and counts as an attempt: five, then the code is void). On success the
-- address is verified, and every workspace whose authorized domains include it gets a Requested Access row (FR-4.3); those come back as
-- rows with created = true so the app can notify their admins. A success with no matching workspace returns one row with a null tenant.
create function public.link_email_verify(p_email text, p_code text)
returns table (ok boolean, tenant_id uuid, tenant_name text, created boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row identity.emails;
  v_new boolean;
  v_any boolean := false;
  t record;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_row from identity.emails where user_id = auth.uid() and email = v_email for update;
  if not found or v_row.verified_at is not null or v_row.code_hash is null
     or v_row.code_expires_at < now() or v_row.code_attempts >= 5 then
    return query select false, null::uuid, null::text, false;
    return;
  end if;
  if v_row.code_hash <> encode(sha256(convert_to(coalesce(btrim(p_code), ''), 'utf8')), 'hex')
     or exists (select 1 from identity.emails e where e.email = v_email and e.verified_at is not null) then
    update identity.emails set code_attempts = code_attempts + 1 where id = v_row.id;
    return query select false, null::uuid, null::text, false;
    return;
  end if;
  update identity.emails set verified_at = now(), code_hash = null, code_expires_at = null, code_attempts = 0 where id = v_row.id;
  perform set_config('app.via', 'system', true);
  for t in select x.id, x.name from public.tenants x where x.allowed_email_domains @> array[split_part(v_email, '@', 2)] order by x.created_at loop
    insert into public.tenant_members (tenant_id, user_id, role, status, requested_via_email)
    values (t.id, auth.uid(), 'viewer', 'requested', v_email)
    on conflict (tenant_id, user_id) do nothing;
    get diagnostics v_new = row_count;
    if v_new then
      v_any := true;
      return query select true, t.id, t.name, true;
    end if;
  end loop;
  if not v_any then
    return query select true, null::uuid, null::text, false;
  end if;
end $$;

-- Removing a linked email. Memberships that exist only because of domain matching on this address go back to Requested Access, so the
-- account admin decides whether the person keeps access (FR-4.6). Memberships from invitations are untouched.
create function public.remove_linked_email(p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from identity.emails where user_id = auth.uid() and email = v_email;
  if not found then raise exception 'no such linked email' using errcode = 'P0002'; end if;
  perform set_config('app.via', 'UI', true);
  update public.tenant_members
     set status = 'requested', status_changed_at = now(), status_changed_by = auth.uid(), requested_via_email = null
   where user_id = auth.uid() and requested_via_email = v_email and status = 'active' and role <> 'admin';
  get diagnostics v_n = row_count;
  -- an admin who got in only through this address cannot be silently demoted (a workspace must keep an admin): leave them, drop the link
  update public.tenant_members set requested_via_email = null where user_id = auth.uid() and requested_via_email = v_email;
  return v_n;
end $$;

create function public.set_notification_email(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update identity.emails set use_for_notifications = false where user_id = auth.uid() and use_for_notifications;
  if v_email = '' or v_email = (select lower(au.email) from auth.users au where au.id = auth.uid()) then
    return;   -- the sign-in email is the default
  end if;
  update identity.emails set use_for_notifications = true where user_id = auth.uid() and email = v_email and verified_at is not null;
  if not found then raise exception 'verify that address first' using errcode = 'PV034'; end if;
end $$;

-- The caller's own addresses: the sign-in email first, then the linked ones.
create function public.my_emails()
returns table (email text, is_sign_in boolean, verified boolean, use_for_notifications boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select lower(au.email)::text, true, au.email_confirmed_at is not null,
         not exists (select 1 from identity.emails e where e.user_id = au.id and e.use_for_notifications), '-infinity'::timestamptz
    from auth.users au where au.id = auth.uid() and au.email is not null
  union all
  select e.email, false, e.verified_at is not null, e.use_for_notifications, e.created_at
    from identity.emails e where e.user_id = auth.uid()
   order by 2 desc, 5
$$;

-- ---------------------------------------------------------------------------
-- Domain matching now looks at every verified email (FR-4.3)
-- ---------------------------------------------------------------------------
create or replace function public.request_access_by_domain()
returns table (tenant_id uuid, tenant_name text, created boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text;
  t record;
  v_new boolean;
  v_primary text;
  v_seen uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select lower(u.email) into v_primary from auth.users u where u.id = auth.uid();
  perform set_config('app.via', 'system', true);
  for v_email in select x from identity.verified_emails(auth.uid()) x where position('@' in x) > 0 order by (x = v_primary) desc, x loop
    for t in select x.id, x.name from public.tenants x where x.allowed_email_domains @> array[split_part(v_email, '@', 2)] order by x.created_at loop
      insert into public.tenant_members (tenant_id, user_id, role, status, requested_via_email)
      values (t.id, auth.uid(), 'viewer', 'requested', case when v_email = v_primary then null else v_email end)
      on conflict (tenant_id, user_id) do nothing;
      get diagnostics v_new = row_count;
      if v_new or exists (select 1 from public.tenant_members m where m.tenant_id = t.id and m.user_id = auth.uid() and m.status = 'requested') then
        -- one row per workspace even when several of the person's addresses match it
        if not (t.id = any (v_seen)) then
          v_seen := v_seen || t.id;
          request_access_by_domain.tenant_id := t.id; request_access_by_domain.tenant_name := t.name; request_access_by_domain.created := v_new;
          return next;
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations: accepted with any verified email of the person; the membership then stands on the invitation, not on a domain match
-- ---------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
   for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now()
     or not (v_inv.email in (select identity.verified_emails(auth.uid()))) then
    raise exception 'invalid or expired invitation' using errcode = 'PV001';
  end if;

  select m.status into v_status from public.tenant_members m
   where m.tenant_id = v_inv.tenant_id and m.user_id = auth.uid();
  if found and v_status = 'active' then
    raise exception 'already a member of this tenant' using errcode = 'PV002';
  elsif found then
    update public.tenant_members
       set status = 'active', role = v_inv.role, is_approver = v_inv.is_approver, requested_via_email = null,
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

-- An approved domain request stands on the admin's decision; only a membership still waiting remembers its email.
-- (Approval keeps requested_via_email so that removing the address can send it back; invitations clear it above.)

-- ---------------------------------------------------------------------------
-- Server-only: sign in with any verified email, and notification addresses
-- ---------------------------------------------------------------------------
-- The sign-in (primary) address of the person who has this verified linked email; null when there is none.
create function public.resolve_sign_in_email(p_email text) returns text
language sql stable security definer set search_path = '' as $$
  select au.email::text from identity.emails e join auth.users au on au.id = e.user_id
   where e.email = lower(btrim(coalesce(p_email, ''))) and e.verified_at is not null
$$;

create or replace function public.tenant_admin_emails(p_tenant uuid) returns setof text
language sql stable security definer set search_path = '' as $$
  select identity.notification_email(m.user_id) from public.tenant_members m join auth.users u on u.id = m.user_id
   where m.tenant_id = p_tenant and m.status = 'active' and m.role = 'admin' and not m.is_service_account and u.email is not null
$$;

revoke all on function
  public.link_email_start(text, text), public.link_email_verify(text, text),
  public.remove_linked_email(text), public.set_notification_email(text), public.my_emails(), public.resolve_sign_in_email(text)
  from public, anon;
grant execute on function
  public.link_email_start(text, text), public.link_email_verify(text, text),
  public.remove_linked_email(text), public.set_notification_email(text), public.my_emails()
  to authenticated;
revoke execute on function public.resolve_sign_in_email(text) from authenticated;
grant execute on function public.resolve_sign_in_email(text) to service_role;
