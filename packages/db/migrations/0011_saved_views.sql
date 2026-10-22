-- 0011: saved views. A view stores the columns (in order), the filters and the grouping the grid shows.
-- Views are shared by everyone in the workspace; creators and admins write them (like saved scopes).
-- A view never stores a project selection: that is the portfolio scope (saved_scopes), chosen separately.
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  columns text[] not null
    check (cardinality(columns) between 1 and 200 and array_position(columns, '') is null and array_position(columns, null) is null),
  filters jsonb not null default '[]' check (jsonb_typeof(filters) = 'array' and jsonb_array_length(filters) <= 20),
  group_by text check (char_length(group_by) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id)
);
create unique index saved_views_name_unique on public.saved_views (tenant_id, lower(btrim(name)));

create trigger saved_views_meta before insert or update on public.saved_views
  for each row execute function public.set_write_meta();
create trigger saved_views_audit after insert or update or delete on public.saved_views
  for each row execute function public.audit_row();

alter table public.saved_views enable row level security;
create policy saved_views_select on public.saved_views for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy saved_views_update on public.saved_views for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.saved_views from public, anon, authenticated;
grant select on public.saved_views to authenticated;
grant insert (id, tenant_id, name, columns, filters, group_by) on public.saved_views to authenticated;
grant update (name, columns, filters, group_by) on public.saved_views to authenticated;
grant delete on public.saved_views to authenticated;
