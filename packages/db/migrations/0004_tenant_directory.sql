-- Clients cannot read auth.users, so members get their tenant's people list
-- (email, role, flags) through this function. Members of the tenant only.
create function public.tenant_directory(p_tenant uuid)
returns table (
  member_id uuid, user_id uuid, email text, role text,
  is_approver boolean, is_service_account boolean, joined_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, u.email::text, m.role, m.is_approver, m.is_service_account, m.created_at
    from public.tenant_members m
    join auth.users u on u.id = m.user_id
   where m.tenant_id = p_tenant
     and public.is_tenant_member(p_tenant)
   order by u.email
$$;

revoke all on function public.tenant_directory(uuid) from public, anon;
grant execute on function public.tenant_directory(uuid) to authenticated;
