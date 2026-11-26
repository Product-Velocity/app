-- Issue #721: Claude can ASK for a Confluence page to be read into Product Velocity (import) or for a document to be updated from its page (refresh).
-- Like a request to publish (item_document_publish_requests), it only records the wish: no page is read, no document is created or changed and no link is
-- made until a person opens the request in the app, sees the preview and confirms (CLAUDE.md rule 3). The link row itself (item_document_pages) refuses an
-- assistant (PV035), so the confirmation can only be a person's. The request holds no page text and no secret.
--
-- Rules in the database, not only the app:
--  * One open import request per initiative and page address, one open refresh request per document (asking again replaces it).
--  * An import names a page address (https) and no document; a refresh names a document on the same initiative and no address (PV036 when it is not).
--  * Row-level security keyed by tenant_id (fast policy pattern); people who edit may write (an assistant writes as the signed-in person, with the same
--    role), everyone in the workspace may read.
-- ADDITIVE: new table, no existing function or data is touched. Apply BEFORE deploying the app version that reads it. Rollback: forward-only; drop the table.

create table public.item_confluence_read_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  kind text not null check (kind in ('import', 'refresh')),
  document_id uuid references public.item_documents (id) on delete cascade,
  page_url text check (page_url is null or (page_url ~* '^https://' and char_length(page_url) <= 2000)),
  doc_kind text check (doc_kind is null or char_length(doc_kind) between 1 and 40),
  sync_mode text not null default 'sync' check (sync_mode in ('once', 'sync')),
  sync_direction text not null default 'from_confluence' check (sync_direction in ('from_confluence', 'both')),
  note text check (note is null or char_length(note) <= 500),
  ai_model text check (ai_model is null or char_length(ai_model) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  check ((kind = 'import' and page_url is not null and document_id is null) or (kind = 'refresh' and document_id is not null and page_url is null))
);
create unique index item_confluence_read_requests_import_key on public.item_confluence_read_requests (item_id, page_url) where kind = 'import';
create unique index item_confluence_read_requests_refresh_key on public.item_confluence_read_requests (document_id) where kind = 'refresh';
create index item_confluence_read_requests_item_idx on public.item_confluence_read_requests (tenant_id, item_id);

alter table public.item_confluence_read_requests enable row level security;
create policy item_confluence_read_requests_select on public.item_confluence_read_requests for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_confluence_read_requests_insert on public.item_confluence_read_requests for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_confluence_read_requests_update on public.item_confluence_read_requests for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_confluence_read_requests_delete on public.item_confluence_read_requests for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.item_confluence_read_requests from public, anon, authenticated;
grant select on public.item_confluence_read_requests to authenticated;
grant insert (tenant_id, item_id, kind, document_id, page_url, doc_kind, sync_mode, sync_direction, note, ai_model) on public.item_confluence_read_requests to authenticated;
grant update (doc_kind, sync_mode, sync_direction, note, ai_model) on public.item_confluence_read_requests to authenticated;
grant delete on public.item_confluence_read_requests to authenticated;

create function public.item_confluence_read_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if new.kind = 'refresh' and not exists (select 1 from public.item_documents d where d.id = new.document_id and d.tenant_id = new.tenant_id and d.item_id = new.item_id) then
      raise exception 'The document is not on this initiative' using errcode = 'PV036';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id or new.item_id is distinct from old.item_id or new.kind is distinct from old.kind
     or new.document_id is distinct from old.document_id or new.page_url is distinct from old.page_url then
    raise exception 'A request cannot be moved to another page or document' using errcode = 'PV036';
  end if;
  return new;
end $$;

create trigger b_platform_suspended_guard before insert or update or delete on public.item_confluence_read_requests
  for each row execute function platform.suspended_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.item_confluence_read_requests
  for each row execute function platform.readonly_guard();
create trigger item_confluence_read_requests_guard before insert or update or delete on public.item_confluence_read_requests
  for each row execute function public.item_confluence_read_requests_guard();
create trigger item_confluence_read_requests_meta before insert or update on public.item_confluence_read_requests for each row execute function public.set_write_meta();
create trigger item_confluence_read_requests_audit after insert or update or delete on public.item_confluence_read_requests for each row execute function public.audit_row();
