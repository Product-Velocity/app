-- Issue #325: the read-only views item_links and item_files (20261105211458) kept the older app version working while item_attachments went live.
-- The version that reads item_attachments is live everywhere, so they go. Nothing is stored in them; no data is touched.
drop view if exists public.item_links;
drop view if exists public.item_files;
