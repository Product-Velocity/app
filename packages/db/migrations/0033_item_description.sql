-- 0033: Description (N44). The technical description engineers and agents work from, written in Markdown (up to 20,000 characters).
-- It is the one long text that goes into its own section of the tracking issue (docs/04); value, customers and decisions never belong in it.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items add column description text check (char_length(description) <= 20000);
grant insert (description) on public.items to authenticated;
grant update (description) on public.items to authenticated;
