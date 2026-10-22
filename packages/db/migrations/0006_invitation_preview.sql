-- Lets an invite link show "Join <workspace> as <role>" before the visitor signs in.
-- Callable by anyone who holds the token (it is a secret with 256 random bits);
-- answers only for a pending, unexpired invitation and exposes nothing else.
create function public.invitation_preview(p_token text)
returns table (tenant_name text, email text, role text, is_approver boolean, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.name, i.email, i.role, i.is_approver, i.expires_at
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
   where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
     and i.accepted_at is null
     and i.revoked_at is null
     and i.expires_at > now()
$$;

revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;
