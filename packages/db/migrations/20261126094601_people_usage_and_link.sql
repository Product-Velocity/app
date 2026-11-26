-- 20261126094601_people_usage_and_link: Members screen for people named before they are invited (issue #691, slice 2).
-- * people_usage(): on how many initiatives each person without an account is named (editors; shown before removing or inviting).
-- * link_person(): an admin links a person named without an account to a member who joined with another email: everything that named
--   the person now names the member, and the person is removed.
-- New functions only; nothing is replaced. Forward-only.

create function public.people_usage(p_tenant uuid)
returns table (person_id uuid, initiatives integer)
language sql stable security definer set search_path = '' as $$
  select p.id, count(distinct i.id)::int
    from public.people p
    join public.items i on i.tenant_id = p.tenant_id and i.deleted_at is null
     and p.id in (i.owner_user_id, i.engineering_manager, i.designer, i.analyst, i.business_manager)
   where p.tenant_id = p_tenant and p.user_id is null
     and p_tenant = any (array (select public.my_editor_tenant_ids()))
   group by p.id
$$;
revoke all on function public.people_usage(uuid) from public, anon;
grant execute on function public.people_usage(uuid) to authenticated;

create function public.link_person(p_tenant uuid, p_person uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.people;
  v_target uuid;
begin
  select * into p from public.people where tenant_id = p_tenant and id = p_person;
  if not found or auth.uid() is null or p.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'person not found' using errcode = '42501';
  end if;
  if p.user_id is not null then raise exception 'That person already has an account' using errcode = 'PV006'; end if;
  select id into v_target from public.people where tenant_id = p.tenant_id and user_id = p_user;
  if v_target is null or not exists (select 1 from public.tenant_members m where m.tenant_id = p.tenant_id and m.user_id = p_user and m.status = 'active' and not m.is_service_account) then
    raise exception 'Choose an active member of this workspace' using errcode = 'PV006';
  end if;
  update public.items set owner_user_id = v_target where tenant_id = p.tenant_id and owner_user_id = p.id;
  update public.items set engineering_manager = v_target where tenant_id = p.tenant_id and engineering_manager = p.id;
  update public.items set designer = v_target where tenant_id = p.tenant_id and designer = p.id;
  update public.items set analyst = v_target where tenant_id = p.tenant_id and analyst = p.id;
  update public.items set business_manager = v_target where tenant_id = p.tenant_id and business_manager = p.id;
  delete from public.people where tenant_id = p.tenant_id and id = p.id;
end $$;
revoke all on function public.link_person(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_person(uuid, uuid, uuid) to authenticated;
