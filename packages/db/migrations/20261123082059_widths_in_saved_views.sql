-- 20261123082059_widths_in_saved_views: a saved view keeps the column widths people dragged (grid request from Ashu, 2026-11-23)
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- widths is an object of field key -> pixels, e.g. {"moscow": 104}. null or an empty object means every column keeps its default width.
-- The app drops unknown columns and clamps the pixels before saving; the check only keeps the shape right. No new table, so the existing
-- saved_views RLS, audit trigger and tenant index apply unchanged. Nothing is rewritten, so the audit trigger does not fire for old rows.

alter table public.saved_views add column widths jsonb;
alter table public.saved_views
  add constraint saved_views_widths_check check (widths is null or jsonb_typeof(widths) = 'object');
grant insert (widths) on public.saved_views to authenticated;
grant update (widths) on public.saved_views to authenticated;
