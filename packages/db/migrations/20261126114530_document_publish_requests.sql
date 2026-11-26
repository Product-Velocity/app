-- Issue #693, slice C: a request to publish a document to Confluence (docs/decisions/2026-11-26-document-home-in-confluence.md).
-- Claude can ASK for a document to be published (where, once or kept in sync, and why); it can never send it. A person opens the request in the app,
-- reviews the preview and confirms (CLAUDE.md rule 3). The request writes nothing to Confluence and holds no secret and no document text.
--
-- Rules in the database, not only the app:
--  * One open request per document (asking again replaces it).
--  * A request belongs to the document's own initiative and workspace (PV036).
--  * Row-level security keyed by tenant_id (fast policy pattern); people who edit may write, everyone in the workspace may read. An assistant writes
--    as the signed-in person, so it needs the same role; it is allowed here because a request sends nothing (the publication itself, `item_document_pages`,
--    refuses an assistant, PV035).
-- ADDITIVE: new table, no existing function or data is touched. Apply BEFORE deploying the app version that reads it.
-- Rollback: forward-only; to go back, drop the table.

create table public.item_document_publish_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  document_id uuid not null references public.item_documents (id) on delete cascade,
  provider text not null default 'confluence' check (provider = 'confluence'),
  space_key text check (space_key is null or space_key ~ '^[~A-Za-z0-9_-]{1,255}$'),
  parent_url text check (parent_url is null or (parent_url ~* '^https://' and char_length(parent_url) <= 2000)),
  page_title text check (page_title is null or char_length(btrim(page_title)) between 1 and 255),
  sync_mode text not null default 'sync' check (sync_mode in ('once', 'sync')),
  note text check (note is null or char_length(note) <= 500),
  ai_model text check (ai_model is null or char_length(ai_model) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create unique index item_document_publish_requests_doc_key on public.item_document_publish_requests (document_id);
create index item_document_publish_requests_item_idx on public.item_document_publish_requests (tenant_id, item_id);

alter table public.item_document_publish_requests enable row level security;
create policy item_document_publish_requests_select on public.item_document_publish_requests for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_document_publish_requests_insert on public.item_document_publish_requests for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_document_publish_requests_update on public.item_document_publish_requests for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_document_publish_requests_delete on public.item_document_publish_requests for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.item_document_publish_requests from public, anon, authenticated;
grant select on public.item_document_publish_requests to authenticated;
grant insert (tenant_id, item_id, document_id, space_key, parent_url, page_title, sync_mode, note, ai_model) on public.item_document_publish_requests to authenticated;
grant update (space_key, parent_url, page_title, sync_mode, note, ai_model) on public.item_document_publish_requests to authenticated;
grant delete on public.item_document_publish_requests to authenticated;

create function public.item_document_publish_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.item_documents d where d.id = new.document_id and d.tenant_id = new.tenant_id and d.item_id = new.item_id) then
      raise exception 'The document is not on this initiative' using errcode = 'PV036';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id or new.item_id is distinct from old.item_id or new.document_id is distinct from old.document_id then
    raise exception 'A publish request cannot be moved to another document' using errcode = 'PV036';
  end if;
  return new;
end $$;

create trigger b_platform_suspended_guard before insert or update or delete on public.item_document_publish_requests
  for each row execute function platform.suspended_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.item_document_publish_requests
  for each row execute function platform.readonly_guard();
create trigger item_document_publish_requests_guard before insert or update or delete on public.item_document_publish_requests
  for each row execute function public.item_document_publish_requests_guard();
create trigger item_document_publish_requests_meta before insert or update on public.item_document_publish_requests for each row execute function public.set_write_meta();
create trigger item_document_publish_requests_audit after insert or update or delete on public.item_document_publish_requests for each row execute function public.audit_row();
