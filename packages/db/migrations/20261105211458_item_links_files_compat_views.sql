-- Compatibility for the version of the app that still reads item_links and item_files (0.94 and older).
-- 20261105165113_item_attachments.sql replaced those two tables by item_attachments; the live database got it before the matching app version was
-- deployed, so every screen of the older app failed with "Could not find the table 'public.item_links'".
-- Read-only views with the old names and columns put the old reads back. They run as the caller (security_invoker), so row-level security of
-- item_attachments decides what anyone sees. Writes through the old app's file and link editors are not supported through the views: use the
-- new version for those.
-- Drop these two views (a later migration) once the version that reads item_attachments is live everywhere.

create view public.item_links with (security_invoker = true) as
  select id, tenant_id, item_id, name as label, url, created_at, updated_at, created_by, created_via
    from public.item_attachments where kind = 'link';

create view public.item_files with (security_invoker = true) as
  select id, tenant_id, item_id, file_kind as kind, name, storage_path, mime_type, size_bytes, share_token, share_updated_at, created_at, updated_at, created_by, created_via
    from public.item_attachments where kind = 'file';

revoke all on public.item_links, public.item_files from public, anon, authenticated;
grant select on public.item_links, public.item_files to authenticated, service_role;
