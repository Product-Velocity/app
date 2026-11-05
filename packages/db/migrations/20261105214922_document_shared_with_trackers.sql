-- Issue #325: written documents are shared with the GitHub issue and the Jira description by default (Ashu, 2026-11-05; CLAUDE.md rule 2 changed).
-- `shared` (default true) is the per-document "Do not share" switch. It is a person's choice: only a column grant for signed-in people is added.
-- ADDITIVE: apply this migration BEFORE deploying the app version that reads the column (the new code selects it).
-- No function is replaced and no data is touched; every existing document becomes shared (the default), which takes effect at the next Sync.

alter table public.item_documents add column shared boolean not null default true;
grant update (shared) on public.item_documents to authenticated;
