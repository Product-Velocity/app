-- 20261126104438_people_directory_all_statuses: paused, revoked and requested members keep their name (issue #698, Ashu 2026-11-26).
-- people_directory() (20261126093428) left out every member who was not Active, so an initiative that named a paused or revoked member
-- showed "unknown person". It now returns every person of the workspace with a status: active, paused, revoked or requested for a member,
-- invited or not_invited for someone without an account. The app resolves names from all of them and offers only the ones that can be
-- chosen. Replaced: public.people_directory (same signature and columns; only the rows and the status values change). No DROP statements.
create or replace function public.people_directory(p_tenant uuid)
returns table (person_id uuid, user_id uuid, name text, email text, status text, role text, is_service_account boolean, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id,
         coalesce(p.name, nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email::text, 'Former member'),
         case when p.user_id is not null then u.email::text
              when p.tenant_id = any (array (select public.my_editor_tenant_ids())) then p.email end,
         case when m.id is not null then m.status
              when p.email is not null and exists (
                select 1 from public.invitations i
                 where i.tenant_id = p.tenant_id and i.email = p.email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
              ) then 'invited'
              else 'not_invited' end,
         m.role, coalesce(m.is_service_account, false), p.user_id is not null and p.user_id = auth.uid()
    from public.people p
    left join public.tenant_members m on m.tenant_id = p.tenant_id and m.user_id = p.user_id
    left join auth.users u on u.id = p.user_id
   where p.tenant_id = p_tenant
     and public.is_tenant_member(p_tenant)
   order by 3
$$;
