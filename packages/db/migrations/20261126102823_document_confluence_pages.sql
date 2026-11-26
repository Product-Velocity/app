-- Issue #693, slice B: a written document can be published to a Confluence page (docs/decisions/2026-11-26-document-home-in-confluence.md,
-- docs/decisions/2026-10-29-confluence-publish.md). One row says which page a document went to and which version of the document it holds.
--
-- Rules in the database, not only the app:
--  * Only a person publishes: a write from an assistant (source MCP) is refused (PV035). Claude can prepare a publication, never send it (CLAUDE.md rule 3).
--  * A publication belongs to the document's own initiative and workspace, and cannot be moved to another page or document (PV036).
--  * One live publication per document (the others are kept as history with `unlinked_at`).
--  * Row-level security keyed by tenant_id (fast policy pattern); people who edit may write, everyone in the workspace may read.
-- No secret lives here: the Atlassian sign-in stays in jira_credentials. The text of a document is never copied into this table (only a hash of what was sent).
-- ADDITIVE: new table, no existing function or data is touched. Apply BEFORE deploying the app version that reads it.
-- Rollback: forward-only; to go back, drop the table (the pages stay in Confluence).

create table public.item_document_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  document_id uuid not null references public.item_documents (id) on delete cascade,
  provider text not null default 'confluence' check (provider = 'confluence'),
  connection_id uuid references public.jira_connections (id) on delete set null,
  site_id text not null check (char_length(site_id) between 1 and 100),
  site_url text check (site_url is null or char_length(site_url) <= 300),
  space_key text not null check (char_length(space_key) between 1 and 255),
  parent_page_id text check (parent_page_id is null or parent_page_id ~ '^[0-9]{1,20}$'),
  page_id text not null check (page_id ~ '^[0-9]{1,20}$'),
  page_url text not null check (page_url ~* '^https://' and char_length(page_url) <= 2000),
  page_title text not null default '' check (char_length(page_title) <= 255),
  source text not null default 'pv' check (source in ('pv', 'external')),
  sync_mode text not null check (sync_mode in ('once', 'sync')),
  published_version integer not null check (published_version >= 1),
  remote_version integer check (remote_version is null or remote_version >= 1),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index item_document_pages_item_idx on public.item_document_pages (tenant_id, item_id);
create index item_document_pages_doc_idx on public.item_document_pages (tenant_id, document_id);
create unique index item_document_pages_live_key on public.item_document_pages (document_id) where unlinked_at is null;

alter table public.item_document_pages enable row level security;
create policy item_document_pages_select on public.item_document_pages for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_document_pages_insert on public.item_document_pages for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_document_pages_update on public.item_document_pages for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_document_pages_delete on public.item_document_pages for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.item_document_pages from public, anon, authenticated;
grant select on public.item_document_pages to authenticated;
grant insert (tenant_id, item_id, document_id, connection_id, site_id, site_url, space_key, parent_page_id, page_id, page_url, page_title, source, sync_mode, published_version, remote_version, content_hash, unlinked_at)
  on public.item_document_pages to authenticated;
grant update (sync_mode, page_title, page_url, published_version, remote_version, content_hash, published_at, unlinked_at) on public.item_document_pages to authenticated;
grant delete on public.item_document_pages to authenticated;

create function public.item_document_pages_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.write_source() = 'MCP' then
    raise exception 'Only a person can publish a document to Confluence. Claude can prepare it; confirm it in Product Velocity.' using errcode = 'PV035';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.item_documents d where d.id = new.document_id and d.tenant_id = new.tenant_id and d.item_id = new.item_id) then
      raise exception 'The document is not on this initiative' using errcode = 'PV036';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id or new.item_id is distinct from old.item_id or new.document_id is distinct from old.document_id
     or new.page_id is distinct from old.page_id or new.site_id is distinct from old.site_id or new.space_key is distinct from old.space_key then
    raise exception 'A publication cannot be moved to another page or document' using errcode = 'PV036';
  end if;
  return new;
end $$;

create trigger b_platform_suspended_guard before insert or update or delete on public.item_document_pages
  for each row execute function platform.suspended_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.item_document_pages
  for each row execute function platform.readonly_guard();
create trigger item_document_pages_guard before insert or update or delete on public.item_document_pages
  for each row execute function public.item_document_pages_guard();
create trigger item_document_pages_meta before insert or update on public.item_document_pages for each row execute function public.set_write_meta();
create trigger item_document_pages_audit after insert or update or delete on public.item_document_pages for each row execute function public.audit_row();
