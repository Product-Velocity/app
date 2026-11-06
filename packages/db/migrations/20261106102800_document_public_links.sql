-- Issue #325: a shared document goes into the GitHub issue / Jira description as its name plus a public link, like a file (Ashu, 2026-11-06).
-- The text stays in Product Velocity; the link opens a read-only page of the current text with no login (/d/<token>/<name>).
--   share_token  exists exactly when the document is shared (`shared`) and is not an unaccepted AI draft (`ai_draft` false). The database makes it
--                (never the client): switching sharing on again, or accepting the draft, makes a new address; switching it off removes the address at once.
--   has_text     generated: whether there is any text. The delivery readers use it instead of reading the text (they never read `body` any more).
-- ADDITIVE and safe to apply BEFORE the app version that uses it. Backfills a token for every document that is already shared and accepted.

alter table public.item_documents
  add column share_token text check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  add column has_text boolean generated always as (char_length(btrim(body)) > 0) stored;
create unique index item_documents_share_token_key on public.item_documents (share_token) where share_token is not null;

create function public.item_documents_share() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.shared and not new.ai_draft then
    -- a new address when the document is added, becomes shared or accepted, or when the client touched the token (null asks for a new one)
    if tg_op = 'INSERT' or old.share_token is null or new.share_token is distinct from old.share_token then
      new.share_token := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 43);
    end if;
  else
    new.share_token := null;
  end if;
  return new;
end $$;
create trigger item_documents_c_share before insert or update on public.item_documents for each row execute function public.item_documents_share();

-- every document that is shared and accepted gets its address now (the trigger makes the token)
update public.item_documents set shared = shared where shared and not ai_draft and share_token is null;
