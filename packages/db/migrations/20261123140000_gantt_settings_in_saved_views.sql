-- 20261123140000_gantt_settings_in_saved_views: a saved view keeps the Gantt's display settings (issue #622, Ashu 2026-11-23)
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- gantt is an object such as {"zoom":"month","g1":"theme","g2":"home_project","density":"compact"}; null means the Gantt's own defaults.
-- The app validates every value before saving; the check only keeps the shape right. No new table, so the existing saved_views
-- RLS, audit trigger and tenant index apply unchanged. Nothing is rewritten, so the audit trigger does not fire for old rows.

alter table public.saved_views add column gantt jsonb;
alter table public.saved_views
  add constraint saved_views_gantt_check check (gantt is null or jsonb_typeof(gantt) = 'object');
grant insert (gantt) on public.saved_views to authenticated;
grant update (gantt) on public.saved_views to authenticated;
