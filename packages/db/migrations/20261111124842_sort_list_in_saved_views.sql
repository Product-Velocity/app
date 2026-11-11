-- 20261111124842_sort_list_in_saved_views: saved views keep an ordered list of sorts (column picker request, 2026-11-11)
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- A saved view now holds an ordered list of sorts (the order of the columns in the column picker), not just one.
-- The sort column stays jsonb: an older single object is still read as a one-item list; new saves write a list.
-- The old check only allowed an object, so it is replaced by one that allows a list of objects too (nothing else changes; no data is rewritten).

alter table public.saved_views drop constraint if exists saved_views_sort_check;
alter table public.saved_views
  add constraint saved_views_sort_check check (sort is null or jsonb_typeof(sort) in ('object', 'array'));

-- Locked columns: a view used to list only the columns locked besides rank, ID and name (which were always locked). It now lists every locked
-- column (up to four, any column, including those three). pins_explicit says which meaning a row has: false = an older row, read as
-- "rank, ID, name and these"; true = the list is the whole set. Nothing is rewritten, so the audit trigger does not fire for old rows.
alter table public.saved_views add column pins_explicit boolean not null default false;
grant insert (pins_explicit) on public.saved_views to authenticated;
grant update (pins_explicit) on public.saved_views to authenticated;
