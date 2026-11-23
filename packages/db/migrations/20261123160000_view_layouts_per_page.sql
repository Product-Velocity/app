-- 20261123160000_view_layouts_per_page: each page (Grid, Cards, Gantt) has its own view bar (issue #625, Ashu 2026-11-23)
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- Until now one layout (the order of the tabs, what is in the bar, what an admin hid) was shared by every page, so reordering the
-- Gantt's three views also reordered the Grid's. view_layouts.page says which page a row belongs to. Every existing row is copied to all
-- three pages first, so nobody's bar changes on the day this runs. saved_views.made_on records the page a view was saved on (null:
-- unknown, for views saved before this); it only labels the view, any view still opens on any page.
-- No new table: the existing RLS, audit trigger and tenant index apply unchanged. The copying is a one-off data move, so the
-- layout triggers are switched off for it (the copies are not edits anyone made) and back on after.

alter table public.view_layouts disable trigger view_layouts_meta;
alter table public.view_layouts disable trigger view_layouts_audit;

alter table public.view_layouts add column page text;
drop index public.view_layouts_unique;

update public.view_layouts set page = 'grid' where page is null;
insert into public.view_layouts (tenant_id, user_id, view_id, builtin, in_bar, position, hidden, created_at, updated_at, created_by, created_via, page)
select tenant_id, user_id, view_id, builtin, in_bar, position, hidden, created_at, updated_at, created_by, created_via, p.page
from public.view_layouts l cross join (values ('cards'), ('gantt')) as p (page)
where l.page = 'grid';

alter table public.view_layouts alter column page set default 'grid';
alter table public.view_layouts alter column page set not null;
alter table public.view_layouts add constraint view_layouts_page_check check (page in ('grid', 'cards', 'gantt'));
create unique index view_layouts_unique on public.view_layouts
  (tenant_id, page, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(view_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(builtin, ''));
grant insert (page) on public.view_layouts to authenticated;

alter table public.view_layouts enable trigger view_layouts_meta;
alter table public.view_layouts enable trigger view_layouts_audit;

-- Replaces one page's layout in one transaction (the person's own, or the workspace default for admins). Same as before, per page.
-- p_page defaults to 'grid' so a browser still running the older code keeps working until it reloads.
drop function public.replace_view_layout(uuid, boolean, jsonb);
create function public.replace_view_layout(p_tenant uuid, p_workspace boolean, p_rows jsonb, p_page text default 'grid') returns void
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if p_page not in ('grid', 'cards', 'gantt') then raise exception 'Unknown page.' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Layout must be a list.' using errcode = 'check_violation'; end if;
  if (select count(*) from jsonb_array_elements(p_rows) r where coalesce((r ->> 'in_bar')::boolean, true)) > 6 then
    raise exception 'Your bar is full (6). Remove one first.' using errcode = 'check_violation';
  end if;
  if p_workspace then
    delete from public.view_layouts where tenant_id = p_tenant and page = p_page and user_id is null;
  else
    delete from public.view_layouts where tenant_id = p_tenant and page = p_page and user_id = uid;
  end if;
  insert into public.view_layouts (tenant_id, user_id, view_id, builtin, in_bar, position, hidden, page)
  select p_tenant, case when p_workspace then null else uid end, nullif(r ->> 'view_id', '')::uuid, nullif(r ->> 'builtin', ''),
         coalesce((r ->> 'in_bar')::boolean, true), (r ->> 'position')::int, coalesce((r ->> 'hidden')::boolean, false), p_page
  from jsonb_array_elements(p_rows) r;
end $$;
revoke all on function public.replace_view_layout(uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.replace_view_layout(uuid, boolean, jsonb, text) to authenticated;

alter table public.saved_views add column made_on text;
alter table public.saved_views add constraint saved_views_made_on_check check (made_on is null or made_on in ('grid', 'cards', 'gantt'));
grant insert (made_on) on public.saved_views to authenticated;
