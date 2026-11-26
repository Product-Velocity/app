-- Issue #714, slice 2: which way a Confluence document is kept up to date, chosen per document and changeable later:
--   from_confluence: the page is the source; Product Velocity reads it and updates the document from it, and never writes to the page;
--   to_confluence:   the document is the source; Product Velocity writes the page and updates it from the document, and never reads it back;
--   both:            either side may change; a change on one side is offered to the other (preview, then a person confirms), and a change on both sides is a
--                    conflict the person settles.
-- Until now the direction was implied by `source` ('pv' wrote the page, 'external' was read from it); `source` stays as the origin of the link.
-- Rules in the database as before: an assistant cannot create or change a publication (PV035 from the existing trigger); the direction is changed only by a person.
-- ADDITIVE: one column with a default, back-filled from `source`; one column added to the existing insert and update grants. No function or policy is touched.
-- Apply BEFORE deploying the app version that reads it. Rollback: drop the column (the app then falls back to `source`).

alter table public.item_document_pages
  add column sync_direction text not null default 'to_confluence' check (sync_direction in ('from_confluence', 'to_confluence', 'both'));
update public.item_document_pages set sync_direction = 'from_confluence' where source = 'external';

grant insert (sync_direction) on public.item_document_pages to authenticated;
grant update (sync_direction) on public.item_document_pages to authenticated;
