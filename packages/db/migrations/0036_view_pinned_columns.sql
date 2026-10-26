-- 0036: pinned columns in saved views (release 0.30.0). A view can pin columns to the left of the grid so they stay while it scrolls:
-- the core columns (rank, ID, name) always are, and one more column may be pinned in the fourth place. Stored as the list of column keys.
-- At most four keys; the application keeps only keys that sit in the first four places.
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
alter table public.saved_views
  add column pinned text[] not null default '{}' check (cardinality(pinned) <= 4);
grant insert (pinned) on public.saved_views to authenticated;
grant update (pinned) on public.saved_views to authenticated;
