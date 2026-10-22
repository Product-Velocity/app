-- A tenant must always keep at least one admin, otherwise nobody can manage
-- people or settings. Applies to everyone, the service role included. Deleting
-- the whole tenant (cascade) is still allowed.
create function public.guard_last_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    -- lock the tenant row so two admins cannot step down at the same time;
    -- if it is gone we are inside a tenant delete and nothing needs protecting
    perform 1 from public.tenants t where t.id = old.tenant_id for update;
    if found and not exists (
      select 1 from public.tenant_members m
       where m.tenant_id = old.tenant_id and m.role = 'admin' and m.id <> old.id
    ) then
      raise exception 'a tenant must keep at least one admin' using errcode = 'PV003';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.guard_last_admin() from public, anon, authenticated;

create trigger tenant_members_guard_last_admin
  before update or delete on public.tenant_members
  for each row execute function public.guard_last_admin();
