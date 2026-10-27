-- 0040: RESET of all saved views (R-97, Ashu's decision 2026-10-27). Deletes every saved_views row, including base_view
-- override rows, so every workspace returns to the built-in views. ONE-OFF: never re-run against real data
-- (docs/14-GO-LIVE-CHECKLIST.md). Forward-only; the Supabase tool pauses on row removals, which is expected.
delete from public.saved_views;
