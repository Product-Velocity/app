-- person_first_last_name: first and last name for people named without an account, and a names reader for Members and greetings
-- (issue #702, Ashu 2026-11-26; follow-up to #691). Emails greet by first name ("Hi {{firstname}},", issue #634); an invitation to someone
-- named but not yet a member had no first name, so it read "Hi there".
-- * people.first_name / people.last_name (up to 60 characters each). `name` stays the joined display name and is kept in step by the functions.
-- * Existing named people are split by the same rule the app uses: "Last, First" when there is a comma, else the first word is the first name
--   and the rest the last name. One word is a first name only. A name is never guessed from an email address.
-- * add_person_names / update_person_names take the two names. add_person / update_person (same signatures) now split the one name they get
--   and delegate, so every older caller keeps working.
-- * person_names(): first and last name of every person of the workspace, for the Members columns and for prefilling onboarding. A member's
--   names come from their own profile (first_name/last_name, else given_name/family_name, else the full name); if the profile has none, the
--   names typed for them before they joined. Members of the workspace only.
-- * people_directory() (replaced, same signature and columns): a member is named by their own profile name (full name, else the name their
--   sign-in provider gave), then the name typed for them before they joined, then their email; someone without an account by the typed name.
-- Replaced (same signature): public.add_person, public.update_person, public.people_directory. New: split_person_name, add_person_names, update_person_names,
-- person_names. No DROP statements.

alter table public.people
  add column first_name text check (first_name is null or char_length(btrim(first_name)) between 1 and 60),
  add column last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 60);

create function public.split_person_name(p_name text)
returns table (first_name text, last_name text)
language sql immutable set search_path = '' as $$
  with s as (select regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g') as n)
  select nullif(case when position(',' in n) > 0 then btrim(substr(n, position(',' in n) + 1)) else split_part(n, ' ', 1) end, ''),
         nullif(case when position(',' in n) > 0 then btrim(split_part(n, ',', 1))
                     when position(' ' in n) > 0 then btrim(substr(n, position(' ' in n) + 1)) end, '')
    from s
$$;
revoke all on function public.split_person_name(text) from public, anon;
grant execute on function public.split_person_name(text) to authenticated;

update public.people p
   set first_name = (select left(s.first_name, 60) from public.split_person_name(p.name) s),
       last_name = (select left(s.last_name, 60) from public.split_person_name(p.name) s)
 where p.name is not null and p.first_name is null and (select s.first_name from public.split_person_name(p.name) s) is not null;

create function public.add_person_names(p_tenant uuid, p_first text, p_last text, p_email text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_first text := btrim(coalesce(p_first, ''));
  v_last text := nullif(btrim(coalesce(p_last, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id uuid;
begin
  if auth.uid() is null or p_tenant is null or p_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'only an editor of the workspace can add a person' using errcode = '42501';
  end if;
  if char_length(v_first) not between 1 and 60 then raise exception 'Enter a first name of 1 to 60 characters' using errcode = 'PV005'; end if;
  if v_last is not null and char_length(v_last) > 60 then raise exception 'A last name can have up to 60 characters' using errcode = 'PV005'; end if;
  if v_email is not null then
    if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'That does not look like an email address' using errcode = 'PV005'; end if;
    if exists (select 1 from public.tenant_members m join auth.users u on u.id = m.user_id where m.tenant_id = p_tenant and lower(u.email::text) = v_email) then
      raise exception 'That email belongs to a member already: pick them from the list' using errcode = 'PV006';
    end if;
    if exists (select 1 from public.people p where p.tenant_id = p_tenant and p.email = v_email) then
      raise exception 'Someone with that email is on the list already' using errcode = 'PV006';
    end if;
  end if;
  insert into public.people (tenant_id, name, first_name, last_name, email)
  values (p_tenant, btrim(v_first || ' ' || coalesce(v_last, '')), v_first, v_last, v_email) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_person_names(uuid, text, text, text) from public, anon;
grant execute on function public.add_person_names(uuid, text, text, text) to authenticated;

create function public.update_person_names(p_tenant uuid, p_id uuid, p_first text, p_last text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.people;
  v_first text := btrim(coalesce(p_first, ''));
  v_last text := nullif(btrim(coalesce(p_last, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  select * into p from public.people where tenant_id = p_tenant and id = p_id;
  if not found or auth.uid() is null or p.tenant_id <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'person not found' using errcode = '42501';
  end if;
  if p.user_id is not null then raise exception 'A member''s name and email come from their account' using errcode = 'PV006'; end if;
  if char_length(v_first) not between 1 and 60 then raise exception 'Enter a first name of 1 to 60 characters' using errcode = 'PV005'; end if;
  if v_last is not null and char_length(v_last) > 60 then raise exception 'A last name can have up to 60 characters' using errcode = 'PV005'; end if;
  if v_email is not null then
    if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'That does not look like an email address' using errcode = 'PV005'; end if;
    if exists (select 1 from public.tenant_members m join auth.users u on u.id = m.user_id where m.tenant_id = p.tenant_id and lower(u.email::text) = v_email) then
      raise exception 'That email belongs to a member already: pick them from the list' using errcode = 'PV006';
    end if;
    if exists (select 1 from public.people o where o.tenant_id = p.tenant_id and o.email = v_email and o.id <> p.id) then
      raise exception 'Someone with that email is on the list already' using errcode = 'PV006';
    end if;
  end if;
  update public.people set name = btrim(v_first || ' ' || coalesce(v_last, '')), first_name = v_first, last_name = v_last, email = v_email
   where tenant_id = p_tenant and id = p_id;
end $$;
revoke all on function public.update_person_names(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.update_person_names(uuid, uuid, text, text, text) to authenticated;

-- the one-name functions of 20261126093428 keep their signatures: they split the name and delegate
create or replace function public.add_person(p_tenant uuid, p_name text, p_email text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public.split_person_name(p_name);
  return public.add_person_names(p_tenant, s.first_name, s.last_name, p_email);
end $$;

create or replace function public.update_person(p_tenant uuid, p_id uuid, p_name text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public.split_person_name(p_name);
  perform public.update_person_names(p_tenant, p_id, s.first_name, s.last_name, p_email);
end $$;

create function public.person_names(p_tenant uuid)
returns table (person_id uuid, user_id uuid, first_name text, last_name text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id,
         left(coalesce(
           case when nullif(u.raw_user_meta_data ->> 'first_name', '') is not null then u.raw_user_meta_data ->> 'first_name'
                when nullif(u.raw_user_meta_data ->> 'given_name', '') is not null then u.raw_user_meta_data ->> 'given_name'
                else (select s.first_name from public.split_person_name(coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.raw_user_meta_data ->> 'name')) s) end,
           p.first_name), 60),
         left(case when nullif(u.raw_user_meta_data ->> 'first_name', '') is not null then nullif(u.raw_user_meta_data ->> 'last_name', '')
                   when nullif(u.raw_user_meta_data ->> 'given_name', '') is not null then nullif(u.raw_user_meta_data ->> 'family_name', '')
                   when (select s.first_name from public.split_person_name(coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.raw_user_meta_data ->> 'name')) s) is not null
                     then (select s.last_name from public.split_person_name(coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.raw_user_meta_data ->> 'name')) s)
                   else p.last_name end, 60),
         p.user_id is not null and p.user_id = auth.uid()
    from public.people p
    left join auth.users u on u.id = p.user_id
   where p.tenant_id = p_tenant and public.is_tenant_member(p_tenant)
$$;
revoke all on function public.person_names(uuid) from public, anon;
grant execute on function public.person_names(uuid) to authenticated;

create or replace function public.people_directory(p_tenant uuid)
returns table (person_id uuid, user_id uuid, name text, email text, status text, role text, is_service_account boolean, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id,
         case when p.user_id is not null
                then coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), p.name, u.email::text, 'Former member')
              else coalesce(p.name, 'Former member') end,
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
