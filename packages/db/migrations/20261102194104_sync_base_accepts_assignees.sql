-- Sync with GitHub: Keep GitHub / Keep Product Velocity did not stick, so the same initiatives came back at the next sync.
-- Cause: the stored base (the hashes both sides agreed on) is written by github_record_base(), and the check on
-- item_github_links.sync_base (sync_base_valid) in the live database still refused the key "assignees" (added in 0048).
-- Every confirm that recorded an assignees hash was therefore rejected as a whole; the app logged it and carried on, so no base
-- was kept for any text or board value either. This redefines the check with all nine keys (hashes only, as before).
-- Idempotent: safe where 0048 was applied in full.
create or replace function public.sync_base_valid(b jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select b is null or (
    jsonb_typeof(b) = 'object'
    and not exists (select 1 from jsonb_each_text(b) e where e.key not in ('title', 'summary', 'description', 'hypothesis', 'priority', 'group', 'due', 'size', 'assignees') or e.value !~ '^[0-9a-f]{64}$')
  )
$$;
