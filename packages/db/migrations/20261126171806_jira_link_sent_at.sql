-- Issue #714: the panel says when a document, file or link last went into the Jira issue description ("In the Jira description · sent 26 Nov 2026, 14:05"),
-- not only whether it is switched on. GitHub already keeps this time (item_github_links.last_pushed_at); Jira had none.
-- `sent_at` is set by the database whenever a sync writes to Jira: on the first create, and whenever the hash of what was sent changes (an update that sent
-- something new). A sync that found nothing to send leaves it alone. Nothing is read back from Jira and no text is stored.
-- ADDITIVE: one nullable column and one trigger on item_jira_links; no function, policy or data is touched. Apply BEFORE deploying the app version that reads it.
-- Rollback: drop the trigger, its function and the column (the panel then falls back to "at the next send").

alter table public.item_jira_links add column sent_at timestamptz;

create function public.item_jira_links_sent_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.sent_hash is not null then new.sent_at := now(); end if;
  elsif new.sent_hash is distinct from old.sent_hash and new.sent_hash is not null then
    new.sent_at := now();
  end if;
  return new;
end $$;

create trigger item_jira_links_sent_at before insert or update on public.item_jira_links
  for each row execute function public.item_jira_links_sent_at();
