-- 0039: view ownership, privacy, per-person bar layout (R-97, release 0.34.0).
-- A saved view is either a WORKSPACE view (owner_id null; everyone reads it, only admins write it) or a PRIVATE view
-- (owner_id = its owner; only the owner reads and writes it, any member including view-only roles). A customised built-in
-- (base_view) is a workspace view. "In bar" means shown in the Roadmap view bar; "pinned" stays the pinned columns (0036).
-- view_layouts holds the bar: one row per person and view (user_id set) or the workspace default (user_id null, admin write).
-- A view is referenced by saved view id OR by built-in name. hidden applies to workspace-default rows of built-ins only.
-- Caps (enforced here, readable messages): 25 private views per person; 25 workspace views, counting the 11 built-ins,
-- so at most 14 added workspace views (customised built-ins replace a built-in and are not counted again).
-- One DROP INDEX (the old name-unique index is replaced by two per-owner ones): the Supabase tool pauses on it; expected.

alter table public.saved_views
  add column owner_id uuid references auth.users (id) on delete cascade,
  add column visibility text not null default 'workspace' check (visibility in ('workspace', 'private')),
  add column sort jsonb check (sort is null or jsonb_typeof(sort) = 'object');

alter table public.saved_views
  add constraint saved_views_owner_matches_visibility
    check ((visibility = 'workspace' and owner_id is null) or (visibility = 'private' and owner_id is not null)),
  add constraint saved_views_private_not_customer_safe check (visibility = 'workspace' or not customer_safe),
  add constraint saved_views_override_is_workspace check (base_view is null or visibility = 'workspace');

drop index public.saved_views_name_unique;
create unique index saved_views_workspace_name_unique on public.saved_views (tenant_id, lower(btrim(name))) where owner_id is null;
create unique index saved_views_private_name_unique on public.saved_views (tenant_id, owner_id, lower(btrim(name))) where owner_id is not null;
create index saved_views_owner on public.saved_views (tenant_id, owner_id);

-- Policies: workspace views are admin-written; private views are written by their owner (any member).
drop policy saved_views_select on public.saved_views;
drop policy saved_views_insert on public.saved_views;
drop policy saved_views_update on public.saved_views;
drop policy saved_views_delete on public.saved_views;
create policy saved_views_select on public.saved_views for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())) and (owner_id is null or owner_id = (select auth.uid())));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (
    (owner_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (owner_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  );
create policy saved_views_update on public.saved_views for update to authenticated
  using (
    (owner_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (owner_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  )
  with check (
    (owner_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (owner_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  );
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (
    (owner_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (owner_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  );

grant insert (owner_id, visibility, sort) on public.saved_views to authenticated;
grant update (owner_id, visibility, sort) on public.saved_views to authenticated;

-- Caps. A per-scope advisory lock keeps two concurrent inserts from both passing the count.
create function public.enforce_view_caps() returns trigger
language plpgsql set search_path = '' as $$
declare
  n int;
begin
  if new.owner_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || new.owner_id::text, 0));
    select count(*) into n from public.saved_views
      where tenant_id = new.tenant_id and owner_id = new.owner_id and id is distinct from new.id;
    if n >= 25 then
      raise exception 'You can have at most 25 private views. Delete one first.' using errcode = 'check_violation';
    end if;
  elsif new.base_view is null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 1));
    select count(*) into n from public.saved_views
      where tenant_id = new.tenant_id and owner_id is null and base_view is null and id is distinct from new.id;
    if n >= 14 then
      raise exception 'A workspace can have at most 25 views, including the 11 built-in ones. Delete or hide one first.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger saved_views_caps before insert or update of owner_id, visibility on public.saved_views
  for each row execute function public.enforce_view_caps();

-- ---------------------------------------------------------------------------
-- view_layouts: the Roadmap view bar
-- ---------------------------------------------------------------------------
create table public.view_layouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  view_id uuid references public.saved_views (id) on delete cascade,
  builtin text check (builtin in ('Prioritisation', 'Planning', 'Delivery', 'Go-to-market', 'Outcomes', 'Leadership', 'Discovery', 'Timeline', 'History', 'Cycle review', 'All columns')),
  in_bar boolean not null default true,
  position int not null check (position between 0 and 100),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  check ((view_id is null) <> (builtin is null)),
  check (user_id is null or not hidden)
);
create unique index view_layouts_unique on public.view_layouts
  (tenant_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(view_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(builtin, ''));
create index view_layouts_view on public.view_layouts (tenant_id, view_id);

create trigger view_layouts_meta before insert or update on public.view_layouts
  for each row execute function public.set_write_meta();
create trigger view_layouts_audit after insert or update or delete on public.view_layouts
  for each row execute function public.audit_row();

alter table public.view_layouts enable row level security;
create policy view_layouts_select on public.view_layouts for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())) and (user_id is null or user_id = (select auth.uid())));
create policy view_layouts_insert on public.view_layouts for insert to authenticated
  with check (
    (user_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (user_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  );
create policy view_layouts_update on public.view_layouts for update to authenticated
  using (
    (user_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (user_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  )
  with check (
    (user_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (user_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  );
create policy view_layouts_delete on public.view_layouts for delete to authenticated
  using (
    (user_id is null and tenant_id = any (array (select public.my_admin_tenant_ids())))
    or (user_id = (select auth.uid()) and tenant_id = any (array (select public.my_tenant_ids())))
  );

revoke all on public.view_layouts from public, anon, authenticated;
grant select on public.view_layouts to authenticated;
grant insert (id, tenant_id, user_id, view_id, builtin, in_bar, position, hidden) on public.view_layouts to authenticated;
grant update (in_bar, position, hidden) on public.view_layouts to authenticated;
grant delete on public.view_layouts to authenticated;

-- Replaces a whole layout in one transaction (the person's own, or the workspace default for admins). Runs with the caller's
-- rights, so RLS decides. p_rows: [{ "view_id": uuid | null, "builtin": text | null, "in_bar": bool, "position": int, "hidden": bool }].
-- An empty list removes the layout (a person goes back to following the workspace default).
create function public.replace_view_layout(p_tenant uuid, p_workspace boolean, p_rows jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Layout must be a list.' using errcode = 'check_violation'; end if;
  if (select count(*) from jsonb_array_elements(p_rows) r where coalesce((r ->> 'in_bar')::boolean, true)) > 6 then
    raise exception 'Your bar is full (6). Remove one first.' using errcode = 'check_violation';
  end if;
  if p_workspace then
    delete from public.view_layouts where tenant_id = p_tenant and user_id is null;
  else
    delete from public.view_layouts where tenant_id = p_tenant and user_id = uid;
  end if;
  insert into public.view_layouts (tenant_id, user_id, view_id, builtin, in_bar, position, hidden)
  select p_tenant, case when p_workspace then null else uid end, nullif(r ->> 'view_id', '')::uuid, nullif(r ->> 'builtin', ''),
         coalesce((r ->> 'in_bar')::boolean, true), (r ->> 'position')::int, coalesce((r ->> 'hidden')::boolean, false)
  from jsonb_array_elements(p_rows) r;
end $$;
revoke all on function public.replace_view_layout(uuid, boolean, jsonb) from public, anon;
grant execute on function public.replace_view_layout(uuid, boolean, jsonb) to authenticated;
