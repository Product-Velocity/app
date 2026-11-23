-- 20261123170000_gantt_surface: the Gantt is a screen of its own (issues #390 and #625, Ashu 2026-11-23: "Finish #390 for all three screens")
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- 20261109225431_view_surfaces.sql gave the Grid and the Cards screen their own saved views, customised default views and view bars
-- (`surface` on saved_views and view_layouts). This adds the third screen: 'gantt'. Nothing is copied: every existing row stays a Grid row,
-- the Gantt starts with its three built-in views and nothing saved. The unique indexes, the caps and the rule that a bar row can only point
-- at a view of its own screen already name `surface`, so they hold for 'gantt' without change.
-- The two check constraints list the allowed screens, so each is replaced by one that also lists 'gantt'. The Supabase tool pauses on the
-- DROP CONSTRAINT lines (expected; they only widen what is allowed). No new table: existing RLS, audit trigger and tenant index apply.

alter table public.saved_views drop constraint saved_views_surface_check;
alter table public.saved_views add constraint saved_views_surface_check check (surface in ('grid', 'cards', 'gantt'));
alter table public.view_layouts drop constraint view_layouts_surface_check;
alter table public.view_layouts add constraint view_layouts_surface_check check (surface in ('grid', 'cards', 'gantt'));

-- replace_view_layout: same as before, with 'gantt' as a known screen. Same name, arguments and grants, so it is replaced in place.
create or replace function public.replace_view_layout(p_tenant uuid, p_workspace boolean, p_rows jsonb, p_surface text default 'grid') returns void
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if p_surface not in ('grid', 'cards', 'gantt') then raise exception 'Unknown screen.' using errcode = 'check_violation'; end if;
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
