-- Issue #693, slice A2: a document made from a Confluence page is created "Do not share" in the same write, so a tracker never sees it (as a public link to
-- its text) before a person decides. `shared` could only be changed afterwards; this lets a person set it when the document is created.
-- ADDITIVE: one column grant, no table, function or data is touched. Apply BEFORE deploying the app version that inserts the column.
-- Rollback: revoke insert (shared) on public.item_documents from authenticated.

grant insert (shared) on public.item_documents to authenticated;
