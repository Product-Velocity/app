-- Invitations: an admin invites an email address with a role and an Approver
-- flag; the invitee accepts with a one-time token after signing in with that
-- (confirmed) email. Only a hash of the token is stored.

-- Write source: also accept the `x-pv-via` request header (PostgREST exposes
-- headers as the `request.headers` setting). Server code sets it; the value is
-- validated. Provenance is advisory until the MCP server (Phase 4) is hardened.
create or replace function public.write_source() returns text
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(current_setting('app.via', true), '');
begin
  if v is null then
    v := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-pv-via', '');
  end if;
  if v is null then
    return case when auth.uid() is null then 'system' else 'API' end;
  end if;
  if v not in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system') then
    raise exception 'invalid write source: %', v;
  end if;
  return v;
end $$;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null
    check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  role text not null check (role in ('viewer', 'commenter', 'creator', 'admin', 'leadership')),
  is_approver boolean not null default false,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system'))
);
create unique index invitations_one_pending_per_email
  on public.invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_tenant_idx on public.invitations (tenant_id);

create trigger invitations_meta before insert or update on public.invitations
  for each row execute function public.set_write_meta();
-- same rule as tenant_members: Claude cannot hand out Approver, not even via an invitation
create trigger invitations_guard_approver before insert or update on public.invitations
  for each row execute function public.guard_approver();
create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function public.audit_row();

alter table public.invitations enable row level security;

create policy invitations_select on public.invitations
  for select to authenticated using (public.is_tenant_admin(tenant_id));
create policy invitations_insert on public.invitations
  for insert to authenticated with check (public.is_tenant_admin(tenant_id));
create policy invitations_update on public.invitations
  for update to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
-- no delete policy: invitations are revoked, never deleted

revoke all on public.invitations from public, anon, authenticated;
grant select on public.invitations to authenticated;
grant insert (tenant_id, email, role, is_approver, token_hash) on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;

-- Accept: the caller must be signed in with the invited, confirmed email.
-- One generic error for every failure so tokens cannot be probed.
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_email text;
  v_confirmed timestamptz;
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

  if exists (select 1 from public.tenant_members m
              where m.tenant_id = v_inv.tenant_id and m.user_id = auth.uid()) then
    raise exception 'already a member of this tenant' using errcode = 'PV002';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, is_approver)
  values (v_inv.tenant_id, auth.uid(), v_inv.role, v_inv.is_approver);

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return v_inv.tenant_id;
end $$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
