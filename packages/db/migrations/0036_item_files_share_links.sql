-- R-034 step 4: files on an initiative, with an optional login-free share link.
-- The file bytes live in the private Storage bucket "item-files"; only the server (service role) reads or writes them.
alter table public.item_files
  add column mime_type text check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf')),
  add column size_bytes integer check (size_bytes between 1 and 10485760),
  add column share_token text check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  add column share_updated_at timestamptz;

create unique index item_files_share_token_key on public.item_files (share_token) where share_token is not null;

-- kind stays 'screenshot' for existing rows; allow documents too.
alter table public.item_files drop constraint if exists item_files_kind_check;
alter table public.item_files add constraint item_files_kind_check check (kind in ('screenshot', 'image', 'document'));

grant insert (mime_type, size_bytes) on public.item_files to authenticated;
grant update (share_token, share_updated_at) on public.item_files to authenticated;
