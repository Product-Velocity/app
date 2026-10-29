-- Company profile: what Claude knows about the company, not about one initiative (issue #269, docs/26-COMPANY-PROFILE.md).
--
-- 1. tenants.company_url: the company website, optional (separate from the authorized email domains).
-- 2. company_profiles: one row per workspace holding the profile sections (industry, position, products, personas, competitors, glossary,
--    voice, sources) as jsonb, versioned. Claude researches the company URL and saves a draft; ONLY a workspace admin confirms it (rule 3).
--    Once confirmed, only an admin can change it; a change made by Claude (as an admin) sends it back to draft for confirmation.
--    Never read for a GitHub payload (rule 2).
-- 3. company_profile_versions: every saved version, written by trigger only.

alter table public.tenants
  add column company_url text check (company_url is null or (char_length(company_url) <= 300 and company_url ~* '^https?://[a-z0-9.-]+\.[a-z]{2,63}(:[0-9]{1,5})?(/[^[:space:]]*)?$'));
grant update (company_url) on public.tenants to authenticated;

create table public.company_profiles (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  sections jsonb not null default '{}'::jsonb check (jsonb_typeof(sections) = 'object' and char_length(sections::text) <= 80000),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  version integer not null default 1 check (version >= 1),
  ai_draft boolean not null default false,
  researched_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  constraint company_profiles_confirmed check ((status = 'confirmed') = (confirmed_at is not null))
);

create table public.company_profile_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  version integer not null,
  sections jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users (id) on delete set null,
  saved_via text not null default 'system',
  unique (tenant_id, version)
);

create function public.company_profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude boolean := public.write_source() = 'Claude MCP';
  v_admin boolean := coalesce(public.is_tenant_admin(new.tenant_id), false);
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := 'draft';
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.ai_draft := v_claude;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'A company profile cannot move to another workspace';
  end if;
  v_changed := new.sections is distinct from old.sections;

  if v_claude and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    raise exception 'Claude cannot confirm the company profile; a workspace admin does' using errcode = 'PV004';
  end if;
  if old.status = 'confirmed' and (v_changed or new.status is distinct from 'confirmed') and not v_admin then
    raise exception 'Only a workspace admin can change a confirmed company profile' using errcode = 'PV004';
  end if;
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and not v_admin then
    raise exception 'Only a workspace admin can confirm the company profile' using errcode = 'PV004';
  end if;

  if v_changed then
    new.version := old.version + 1;
    if v_claude then
      new.ai_draft := true;
      new.status := 'draft'; -- a change by Claude always needs a person to confirm it again
    end if;
  else
    new.version := old.version;
  end if;

  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
    new.ai_draft := false; -- a person accepted it
  elsif new.status = 'confirmed' then
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  else
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end $$;

create function public.company_profiles_save_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.company_profile_versions (tenant_id, version, sections, saved_by, saved_via)
    values (new.tenant_id, new.version, new.sections, auth.uid(), public.write_source());
  end if;
  return null;
end $$;

-- Audit without the text (the versions table holds it): actor, source, time, old and new value of the other columns.
create function public.company_profiles_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
  k text;
  o jsonb;
  n jsonb;
begin
  for k in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new)) s
    where key not in ('updated_at', 'created_at')
  loop
    o := v_old -> k;
    n := v_new -> k;
    if k = 'sections' then
      o := case when tg_op = 'INSERT' then null else jsonb_build_object('characters', char_length((v_old -> 'sections')::text)) end;
      n := jsonb_build_object('characters', char_length((v_new -> 'sections')::text));
    end if;
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (new.tenant_id, tg_table_name, new.tenant_id, k, o, n, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;

create trigger company_profiles_a_meta before insert or update on public.company_profiles
  for each row execute function public.set_write_meta();
create trigger company_profiles_b_guard before insert or update on public.company_profiles
  for each row execute function public.company_profiles_guard();
create trigger company_profiles_version after insert or update on public.company_profiles
  for each row execute function public.company_profiles_save_version();
create trigger company_profiles_audit after insert or update on public.company_profiles
  for each row execute function public.company_profiles_audit();

create trigger a_platform_readonly_guard before insert or update or delete on public.company_profiles
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.company_profile_versions
  for each row execute function platform.readonly_guard();

-- RLS (fast policy pattern, spike S7). Editors write drafts; the guard reserves a confirmed profile and confirmation for admins.
alter table public.company_profiles enable row level security;
alter table public.company_profile_versions enable row level security;

create policy company_profiles_select on public.company_profiles for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy company_profiles_insert on public.company_profiles for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy company_profiles_update on public.company_profiles for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy company_profile_versions_select on public.company_profile_versions for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));

revoke all on public.company_profiles, public.company_profile_versions from public, anon, authenticated;
grant select on public.company_profiles, public.company_profile_versions to authenticated;
grant insert (tenant_id, sections, researched_at) on public.company_profiles to authenticated;
grant update (sections, status, researched_at) on public.company_profiles to authenticated;

revoke all on function public.company_profiles_guard(), public.company_profiles_save_version(), public.company_profiles_audit() from public, anon, authenticated;
