-- Company brand (issue #750, docs/decisions/2026-11-28-company-brand.md): the logo, main and accent colours and fonts a workspace wants its voting screens, emails
-- and (later) its whole interface to carry. One row per workspace, set by an admin and confirmed by an admin; Claude (source MCP) may propose, never confirm (PV004).
-- A brand only takes effect when it is confirmed AND the admin switched it on (use_on_voting, use_in_app); a proposal never changes a live look.
-- Logo: the file lives in the private file store (a PNG made by the server from whatever was uploaded, never the original); the row holds its path, hash and size,
--   written only by workspace_brand_set_logo(), which checks the path belongs to this workspace. public_token is the random address of the public logo image
--   (/b/<token>/logo): voters have no account, so the logo of a CONFIRMED brand is served without sign-in, and nothing else is.
-- tenant_has_feature(): the one place that will say whether a plan includes a feature. Branding becomes a paid-plan feature when plans exist (Ashu,
--   2026-11-28); until then every workspace has it, and the guard below already asks the question.
-- Never read for a GitHub or Jira payload (rule 2).
create function public.tenant_has_feature(p_tenant uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select true; -- every workspace has every feature until plans exist (docs/14-GO-LIVE-CHECKLIST.md: gate branding to paid plans)
$$;
revoke all on function public.tenant_has_feature(uuid, text) from public, anon;
grant execute on function public.tenant_has_feature(uuid, text) to authenticated, service_role;

create table public.workspace_brand (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$'),
  heading_font text check (heading_font is null or char_length(heading_font) between 1 and 80),
  body_font text check (body_font is null or char_length(body_font) between 1 and 80),
  logo_path text check (logo_path is null or logo_path ~ '^brand/[0-9a-f-]{36}/[0-9a-f]{64}\.png$'),
  logo_sha text check (logo_sha is null or logo_sha ~ '^[0-9a-f]{64}$'),
  logo_width integer check (logo_width is null or logo_width between 1 and 4000),
  logo_height integer check (logo_height is null or logo_height between 1 and 4000),
  public_token text not null default left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 32)
    check (public_token ~ '^[0-9a-f]{32}$'),
  source text check (source is null or source in ('typed', 'website', 'presentation', 'claude')),
  source_note text check (source_note is null or char_length(source_note) <= 300),
  detected_at timestamptz,
  use_on_voting boolean not null default false,
  use_in_app boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  version integer not null default 1 check (version >= 1),
  ai_draft boolean not null default false,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  constraint workspace_brand_confirmed check ((status = 'confirmed') = (confirmed_at is not null)),
  constraint workspace_brand_logo_all_or_none check ((logo_path is null) = (logo_sha is null) and (logo_path is null) = (logo_width is null) and (logo_path is null) = (logo_height is null))
);
create unique index workspace_brand_public_token_key on public.workspace_brand (public_token);

create function public.workspace_brand_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude boolean := public.write_source() = 'MCP';
  v_admin boolean := coalesce(public.is_tenant_admin(new.tenant_id), false);
  v_changed boolean;
begin
  if not public.tenant_has_feature(new.tenant_id, 'branding') then
    raise exception 'Company branding is not part of this workspace''s plan' using errcode = 'PV031';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := 'draft';
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.ai_draft := v_claude;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'A brand cannot move to another workspace';
  end if;
  if new.public_token is distinct from old.public_token then
    raise exception 'The public address of the logo cannot be changed';
  end if;
  v_changed := (new.display_name, new.primary_color, new.accent_color, new.heading_font, new.body_font, new.logo_sha)
    is distinct from (old.display_name, old.primary_color, old.accent_color, old.heading_font, old.body_font, old.logo_sha);

  if v_claude and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    raise exception 'Claude cannot confirm the brand; a workspace admin does' using errcode = 'PV004';
  end if;
  if old.status = 'confirmed' and (v_changed or new.status is distinct from 'confirmed') and not v_admin then
    raise exception 'Only a workspace admin can change a confirmed brand' using errcode = 'PV004';
  end if;
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and not v_admin then
    raise exception 'Only a workspace admin can confirm the brand' using errcode = 'PV004';
  end if;
  if (new.use_on_voting is distinct from old.use_on_voting or new.use_in_app is distinct from old.use_in_app) and not v_admin then
    raise exception 'Only a workspace admin can switch the brand on or off' using errcode = 'PV004';
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

  if new.status = 'confirmed' and new.primary_color is null then
    raise exception 'Give the brand a main colour before confirming it' using errcode = '22023';
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

-- Audit: actor, source, time, old and new value of every column except the housekeeping ones.
create function public.workspace_brand_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
  k text;
begin
  for k in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new)) s
    where key not in ('updated_at', 'created_at', 'public_token')
  loop
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (new.tenant_id, tg_table_name, new.tenant_id, k, v_old -> k, v_new -> k, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;

create trigger workspace_brand_a_meta before insert or update on public.workspace_brand
  for each row execute function public.set_write_meta();
create trigger workspace_brand_b_guard before insert or update on public.workspace_brand
  for each row execute function public.workspace_brand_guard();
create trigger workspace_brand_audit after insert or update on public.workspace_brand
  for each row execute function public.workspace_brand_audit();
create trigger a_platform_readonly_guard before insert or update or delete on public.workspace_brand
  for each row execute function platform.readonly_guard();
create trigger b_platform_suspended_guard before insert or update or delete on public.workspace_brand
  for each row execute function platform.suspended_guard();

-- RLS (fast policy pattern, spike S7). Every member reads (the colours dress the interface they use); only admins write.
alter table public.workspace_brand enable row level security;
create policy workspace_brand_select on public.workspace_brand for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy workspace_brand_insert on public.workspace_brand for insert to authenticated
  with check (tenant_id = any (array (select public.my_admin_tenant_ids())));
create policy workspace_brand_update on public.workspace_brand for update to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())))
  with check (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.workspace_brand from public, anon, authenticated;
grant select on public.workspace_brand to authenticated;
grant insert (tenant_id, display_name, primary_color, accent_color, heading_font, body_font, source, source_note, detected_at, use_on_voting, use_in_app) on public.workspace_brand to authenticated;
grant update (display_name, primary_color, accent_color, heading_font, body_font, source, source_note, detected_at, status, use_on_voting, use_in_app) on public.workspace_brand to authenticated;
grant all on public.workspace_brand to service_role;
revoke all on function public.workspace_brand_guard(), public.workspace_brand_audit() from public, anon, authenticated;

-- The logo columns are written only here: the server makes the PNG, stores it, and records it; the path must belong to this workspace.
create function public.workspace_brand_set_logo(p_tenant uuid, p_path text, p_sha text, p_width integer, p_height integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'Only a workspace admin can set the logo' using errcode = '42501';
  end if;
  if p_path is null or p_path <> 'brand/' || p_tenant::text || '/' || p_sha || '.png' then
    raise exception 'The logo file does not belong to this workspace' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  insert into public.workspace_brand (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.workspace_brand set logo_path = p_path, logo_sha = p_sha, logo_width = p_width, logo_height = p_height where tenant_id = p_tenant;
end $$;
revoke all on function public.workspace_brand_set_logo(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.workspace_brand_set_logo(uuid, text, text, integer, integer) to authenticated;

create function public.workspace_brand_clear_logo(p_tenant uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'Only a workspace admin can remove the logo' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.workspace_brand set logo_path = null, logo_sha = null, logo_width = null, logo_height = null where tenant_id = p_tenant;
end $$;
revoke all on function public.workspace_brand_clear_logo(uuid) from public, anon;
grant execute on function public.workspace_brand_clear_logo(uuid) to authenticated;
