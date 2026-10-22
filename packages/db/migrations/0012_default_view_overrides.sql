-- 0012: customised default views and customer-safe views.
-- base_view: a row with it replaces the built-in default view of that name for the whole workspace (at most one per name);
--   deleting the row restores the default. The defaults themselves are generated from the field dictionary, not stored.
-- customer_safe: the view may only hold fields the sheet "Grid columns and views" marks customer-safe, so a commercial
--   field can never be in one. The list below is checked against docs/reference/grid-views.csv by packages/db/tests.
--   Target Markets and Live Markets are left out on purpose (docs/03: markets are commercial).
alter table public.saved_views
  add column base_view text
    check (base_view in ('Prioritisation', 'Planning', 'Delivery', 'Go-to-market', 'Outcomes', 'Leadership', 'Discovery', 'History')),
  add column customer_safe boolean not null default false;

create unique index saved_views_base_unique on public.saved_views (tenant_id, base_view) where base_view is not null;

create function public.customer_safe_field_keys() returns text[]
  language sql immutable parallel safe set search_path = ''
as $$ select array['item_code', 'roadmap_category', 'theme', 'initiative_name', 'focus_area', 'change_type', 'g2m_quarter', 'audience', 'summary', 'horizon', 'value_proposition', 'target_segments', 'screenshots', 'date_precision']::text[] $$;

alter table public.saved_views
  add constraint saved_views_customer_safe_columns check (not customer_safe or columns <@ public.customer_safe_field_keys()),
  add constraint saved_views_override_not_customer_safe check (base_view is null or not customer_safe);

grant insert (base_view, customer_safe) on public.saved_views to authenticated;
grant update (customer_safe) on public.saved_views to authenticated;
