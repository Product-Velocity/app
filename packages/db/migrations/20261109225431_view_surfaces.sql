-- Views belong to a screen: the Grid and the Cards screen each have their own views and their own view bar.
-- Until now both screens read and wrote the same saved_views and view_layouts rows, so customising "Delivery" on Cards
-- overwrote the Grid's Delivery view (Ashu, 2026-11-09). `surface` says which screen a row belongs to. Every existing
-- row is a Grid row (the default); the Cards screen starts with its own built-in views and none saved.
-- Everything that was unique per workspace or person is now unique per screen as well: a Grid view and a Cards view may share a
-- name, and each screen has its own customised "Delivery" (base_view) and its own bar. The caps (25 private views per person,
-- 14 added workspace views) count per screen. DROP INDEX appears below (each old unique index is replaced by one that also
-- names the screen): the Supabase tool pauses on it; expected.

alter table public.saved_views
  add column surface text not null default 'grid' check (surface in ('grid', 'cards'));
alter table public.view_layouts
  add column surface text not null default 'grid' check (surface in ('grid', 'cards'));

-- saved_views: unique names and one customised built-in per screen
drop index public.saved_views_base_unique;
drop index public.saved_views_workspace_name_unique;
drop index public.saved_views_private_name_unique;
create unique index saved_views_base_unique on public.saved_views (tenant_id, surface, base_view) where base_view is not null;
create unique index saved_views_workspace_name_unique on public.saved_views (tenant_id, surface, lower(btrim(name))) where owner_id is null;
create unique index saved_views_private_name_unique on public.saved_views (tenant_id, owner_id, surface, lower(btrim(name))) where owner_id is not null;

-- view_layouts: one bar per person (or workspace default) and screen
drop index public.view_layouts_unique;
create unique index view_layouts_unique on public.view_layouts
  (tenant_id, surface, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(view_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(builtin, ''));

grant insert (surface) on public.saved_views to authenticated;
grant insert (surface) on public.view_layouts to authenticated;
-- the screen of a view or a bar row is fixed when it is written: no update grant on surface.

-- A saved view and a bar row that points at it must be on the same screen.
create function public.enforce_view_layout_surface() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.view_id is not null and not exists (
    select 1 from public.saved_views v where v.id = new.view_id and v.tenant_id = new.tenant_id and v.surface = new.surface
  ) then
    raise exception 'That view belongs to another screen.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger view_layouts_surface before insert on public.view_layouts
  for each row execute function public.enforce_view_layout_surface();

-- Caps per screen. Same rules and messages as 0041; the count is limited to the new row's screen.
create or replace function public.enforce_view_caps() returns trigger
language plpgsql set search_path = '' as $$
declare
  n int;
begin
  if new.owner_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || new.owner_id::text || new.surface, 0));
    select count(*) into n from public.saved_views
      where tenant_id = new.tenant_id and owner_id = new.owner_id and surface = new.surface and id is distinct from new.id;
    if n >= 25 then
      raise exception 'You can have at most 25 private views. Delete one first.' using errcode = 'check_violation';
    end if;
  elsif new.base_view is null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || new.surface, 1));
    select count(*) into n from public.saved_views
      where tenant_id = new.tenant_id and owner_id is null and base_view is null and surface = new.surface and id is distinct from new.id;
    if n >= 14 then
      raise exception 'A workspace can have at most 25 views, including the 11 built-in ones. Delete or hide one first.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- replace_view_layout: now replaces the bar of one screen (p_surface, 'grid' when left out, so older callers keep working).
drop function public.replace_view_layout(uuid, boolean, jsonb);
create function public.replace_view_layout(p_tenant uuid, p_workspace boolean, p_rows jsonb, p_surface text default 'grid') returns void
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if p_surface not in ('grid', 'cards') then raise exception 'Unknown screen.' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Layout must be a list.' using errcode = 'check_violation'; end if;
  if (select count(*) from jsonb_array_elements(p_rows) r where coalesce((r ->> 'in_bar')::boolean, true)) > 6 then
    raise exception 'Your bar is full (6). Remove one first.' using errcode = 'check_violation';
  end if;
  if p_workspace then
    delete from public.view_layouts where tenant_id = p_tenant and user_id is null and surface = p_surface;
  else
    delete from public.view_layouts where tenant_id = p_tenant and user_id = uid and surface = p_surface;
  end if;
  insert into public.view_layouts (tenant_id, user_id, view_id, builtin, in_bar, position, hidden, surface)
  select p_tenant, case when p_workspace then null else uid end, nullif(r ->> 'view_id', '')::uuid, nullif(r ->> 'builtin', ''),
         coalesce((r ->> 'in_bar')::boolean, true), (r ->> 'position')::int, coalesce((r ->> 'hidden')::boolean, false), p_surface
  from jsonb_array_elements(p_rows) r;
end $$;
revoke all on function public.replace_view_layout(uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.replace_view_layout(uuid, boolean, jsonb, text) to authenticated;
