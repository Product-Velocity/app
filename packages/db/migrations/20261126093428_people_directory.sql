-- 20261126093428_people_directory: a people directory, so Product Manager, Engineering Manager, Designer, Analyst and Business
-- Manager can name someone who is not a member yet (issue #691, slice 1; docs/decisions/2026-11-26-people-directory.md).
--
-- * `people`: one row per named person of a workspace. A member is a person whose id is their user id (so every value already
--   stored in those five item columns stays valid, no item is rewritten). Someone named before they have an account is a person
--   with no user_id, a name and optionally an email. When they join (an invitation, domain auto-join) the row is linked to the
--   account by email; its id never changes, so nothing on any initiative moves.
-- * The five person columns of items now point at people(tenant_id, id) instead of tenant_members(tenant_id, user_id).
-- * A person without an account has no role and no access. Gate approvers, decided_by, notifications and assignees still point
--   at real members. Participants of an alignment session stay separate (docs/19): nothing here links to them.
-- * "Invited" is not stored: it is a pending invitation to the same email (like members_grid does).
-- * Replaces request_outcome_review (same signature) so the review goes to the account behind the Product Manager person.
-- Forward-only. Never edit this file after it is applied; add a new migration instead.

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
create table public.people (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- a member's name comes from their account; this is the name typed for someone without one (kept if they leave)
  name text check (name is null or char_length(btrim(name)) between 1 and 120),
  -- only for a person without an account: once they join the account holds the email
  email text check (email is null or (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  -- the same account can be a member of several workspaces, and a member's person id is their user id: the id is unique per workspace
  primary key (tenant_id, id),
  unique (tenant_id, user_id)
);
create unique index people_email_unique on public.people (tenant_id, email) where email is not null;

-- every current member is a person with the same id as their user id
insert into public.people (id, tenant_id, user_id)
select m.user_id, m.tenant_id, m.user_id from public.tenant_members m
on conflict do nothing;

create trigger people_meta before insert or update on public.people
  for each row execute function public.set_write_meta();
create trigger people_audit after insert or update or delete on public.people
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.people
  for each row execute function platform.readonly_guard();
create trigger b_platform_suspended_guard before insert or update or delete on public.people
  for each row execute function platform.suspended_guard();

alter table public.people enable row level security;
-- the table itself is for admins; everyone else reads names through people_directory()
create policy people_select on public.people for select to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.people from public, anon, authenticated;
grant select on public.people to authenticated;

-- ---------------------------------------------------------------------------
-- a new member is a person: linked to the one named before they joined (same email), else to their own row, else a new row
-- ---------------------------------------------------------------------------
create function public.people_link_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_id uuid;
begin
  -- a person with this id already exists (a member who left and came back): reconnect it
  update public.people set user_id = new.user_id, email = null
   where tenant_id = new.tenant_id and id = new.user_id returning id into v_id;
  if v_id is not null then return new; end if;

  select lower(btrim(u.email::text)) into v_email from auth.users u where u.id = new.user_id;
  if v_email is not null then
    update public.people set user_id = new.user_id, email = null
     where tenant_id = new.tenant_id and user_id is null and email = v_email returning id into v_id;
    if v_id is not null then return new; end if;
  end if;

  insert into public.people (id, tenant_id, user_id) values (new.user_id, new.tenant_id, new.user_id);
  return new;
end $$;
revoke all on function public.people_link_member() from public, anon, authenticated;
create trigger tenant_members_people_link after insert on public.tenant_members
  for each row execute function public.people_link_member();

-- a member removed from the workspace stays on the initiatives as a name (it no longer clears them); with no account left at all
-- (the account was deleted) they become "Former member" and nothing else about them is kept
create function public.people_unlink_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_email text;
begin
  select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email::text), lower(btrim(u.email::text))
    into v_name, v_email from auth.users u where u.id = old.user_id;
  update public.people
     set user_id = null,
         name = coalesce(name, left(v_name, 120), 'Former member'),
         email = case when v_name is null then null else v_email end
   where tenant_id = old.tenant_id and user_id = old.user_id;
  return old;
end $$;
revoke all on function public.people_unlink_member() from public, anon, authenticated;
create trigger tenant_members_people_unlink after delete on public.tenant_members
  for each row execute function public.people_unlink_member();

-- ---------------------------------------------------------------------------
-- the five person columns of items point at people
-- ---------------------------------------------------------------------------
alter table public.items
  drop constraint items_tenant_id_owner_user_id_fkey,
  drop constraint items_engineering_manager_fk,
  drop constraint items_designer_fk,
  drop constraint items_analyst_fk,
  drop constraint items_business_manager_fk;
alter table public.items
  add constraint items_owner_person_fk foreign key (tenant_id, owner_user_id) references public.people (tenant_id, id) on delete set null (owner_user_id),
  add constraint items_engineering_manager_fk foreign key (tenant_id, engineering_manager) references public.people (tenant_id, id) on delete set null (engineering_manager),
  add constraint items_designer_fk foreign key (tenant_id, designer) references public.people (tenant_id, id) on delete set null (designer),
  add constraint items_analyst_fk foreign key (tenant_id, analyst) references public.people (tenant_id, id) on delete set null (analyst),
  add constraint items_business_manager_fk foreign key (tenant_id, business_manager) references public.people (tenant_id, id) on delete set null (business_manager);

-- ---------------------------------------------------------------------------
-- the directory the pickers, grid, reports and Claude read: active members and everyone named without an account
-- (emails of people without an account are for editors and admins only)
-- ---------------------------------------------------------------------------
create function public.people_directory(p_tenant uuid)
returns table (person_id uuid, user_id uuid, name text, email text, status text, role text, is_service_account boolean, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id,
         coalesce(p.name, nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email::text, 'Former member'),
         case when p.user_id is not null then u.email::text
              when p.tenant_id = any (array (select public.my_editor_tenant_ids())) then p.email end,
         case when m.id is not null then 'active'
              when p.email is not null and exists (
                select 1 from public.invitations i
                 where i.tenant_id = p.tenant_id and i.email = p.email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
              ) then 'invited'
              else 'not_invited' end,
         m.role, coalesce(m.is_service_account, false), p.user_id is not null and p.user_id = auth.uid()
    from public.people p
    left join public.tenant_members m on m.tenant_id = p.tenant_id and m.user_id = p.user_id and m.status = 'active'
    left join auth.users u on u.id = p.user_id
   where p.tenant_id = p_tenant
     and public.is_tenant_member(p_tenant)
     and (p.user_id is null or m.id is not null)
   order by 3
$$;
revoke all on function public.people_directory(uuid) from public, anon;
grant execute on function public.people_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- naming someone, renaming, removing (people without an account only; a member's name is their account's)
-- ---------------------------------------------------------------------------
create function public.add_person(p_tenant uuid, p_name text, p_email text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id uuid;
begin
  if auth.uid() is null or p_tenant is null or p_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'only an editor of the workspace can add a person' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'Enter a name of 1 to 120 characters' using errcode = 'PV005'; end if;
  if v_email is not null then
    if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'That does not look like an email address' using errcode = 'PV005'; end if;
    if exists (select 1 from public.tenant_members m join auth.users u on u.id = m.user_id where m.tenant_id = p_tenant and lower(u.email::text) = v_email) then
      raise exception 'That email belongs to a member already: pick them from the list' using errcode = 'PV006';
    end if;
    if exists (select 1 from public.people p where p.tenant_id = p_tenant and p.email = v_email) then
      raise exception 'Someone with that email is on the list already' using errcode = 'PV006';
    end if;
  end if;
  insert into public.people (tenant_id, name, email) values (p_tenant, v_name, v_email) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_person(uuid, text, text) from public, anon;
grant execute on function public.add_person(uuid, text, text) to authenticated;

create function public.update_person(p_tenant uuid, p_id uuid, p_name text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.people;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  select * into p from public.people where tenant_id = p_tenant and id = p_id;
  if not found or auth.uid() is null or p.tenant_id <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'person not found' using errcode = '42501';
  end if;
  if p.user_id is not null then raise exception 'A member''s name and email come from their account' using errcode = 'PV006'; end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'Enter a name of 1 to 120 characters' using errcode = 'PV005'; end if;
  if v_email is not null then
    if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'That does not look like an email address' using errcode = 'PV005'; end if;
    if exists (select 1 from public.tenant_members m join auth.users u on u.id = m.user_id where m.tenant_id = p.tenant_id and lower(u.email::text) = v_email) then
      raise exception 'That email belongs to a member already: pick them from the list' using errcode = 'PV006';
    end if;
    if exists (select 1 from public.people o where o.tenant_id = p.tenant_id and o.email = v_email and o.id <> p.id) then
      raise exception 'Someone with that email is on the list already' using errcode = 'PV006';
    end if;
  end if;
  update public.people set name = v_name, email = v_email where tenant_id = p_tenant and id = p_id;
end $$;
revoke all on function public.update_person(uuid, uuid, text, text) from public, anon;
grant execute on function public.update_person(uuid, uuid, text, text) to authenticated;

-- an admin removes a name nobody should use any more; it is cleared from the initiatives that carry it (the foreign keys set them null)
create function public.remove_person(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.people;
begin
  select * into p from public.people where tenant_id = p_tenant and id = p_id;
  if not found or auth.uid() is null or p.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'person not found' using errcode = '42501';
  end if;
  if p.user_id is not null then raise exception 'A member is removed from Members, not from the list of names' using errcode = 'PV006'; end if;
  delete from public.people where tenant_id = p_tenant and id = p_id;
end $$;
revoke all on function public.remove_person(uuid, uuid) from public, anon;
grant execute on function public.remove_person(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- request_outcome_review (replaced, same signature): the review goes to the account behind the Product Manager person
-- ---------------------------------------------------------------------------
create or replace function public.request_outcome_review(p_item uuid, p_at_days integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_pm uuid;
  v_to uuid;
  v_id uuid;
begin
  if p_at_days not in (30, 60, 90) then raise exception 'The review is at 30, 60 or 90 days' using errcode = 'PV005'; end if;
  select i.id, i.tenant_id, i.start_rollout, i.owner_user_id, i.created_by, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(it.tenant_id);
  if it.start_rollout is null then raise exception 'This initiative has no Start Roll-Out date yet, so the review has no due date' using errcode = 'PV005'; end if;
  -- the account behind the Product Manager (a person named without an account has none)
  select p.user_id into v_pm from public.people p where p.tenant_id = it.tenant_id and p.id = it.owner_user_id;
  -- the Product Manager, else the creator, when they are still an active member of this workspace
  select m.user_id into v_to from public.tenant_members m
   where m.tenant_id = it.tenant_id and m.status = 'active' and not m.is_service_account and m.user_id in (v_pm, it.created_by)
   order by (m.user_id = v_pm) desc nulls last limit 1;
  begin
    insert into public.outcome_reviews (tenant_id, item_id, at_days, due_on, requested_at, requested_by, requested_to)
    values (it.tenant_id, p_item, p_at_days, it.start_rollout + p_at_days, now(), auth.uid(), v_to)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'The % day review has already been requested or recorded', p_at_days::text using errcode = 'PV006';
  end;
  return v_id;
end $$;
