-- The invite page opens in the right mode (sign in vs create account) when it
-- knows whether the invited email already has an account. Only the holder of
-- the secret link can ask, and only about the address the invitation is for.
-- Additive (a separate function), so invitation_preview from 0006 is unchanged.
create function public.invitation_account_exists(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select exists (select 1 from auth.users u where lower(u.email) = i.email)
       from public.invitations i
      where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
        and i.accepted_at is null
        and i.revoked_at is null
        and i.expires_at > now()),
    false)
$$;

revoke all on function public.invitation_account_exists(text) from public;
grant execute on function public.invitation_account_exists(text) to anon, authenticated;
