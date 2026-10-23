-- 0016: ten default views (R-021, #54). Timeline and Cycle review join the eight; a workspace can customise each one.
-- The check on saved_views.base_view (0012) lists the view names, so it is replaced by one that lists all ten.
-- The default views themselves are generated from docs/reference/default-views.csv in code; nothing is stored for them,
-- so existing workspaces get the new column lists without touching any saved view or customised default.
alter table public.saved_views drop constraint saved_views_base_view_check;
alter table public.saved_views
  add constraint saved_views_base_view_check
  check (base_view in ('Prioritisation', 'Planning', 'Delivery', 'Go-to-market', 'Outcomes', 'Leadership', 'Discovery', 'Timeline', 'History', 'Cycle review'));
