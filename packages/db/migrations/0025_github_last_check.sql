-- 0025: "Check GitHub now" runs in the background and leaves a short result on the connection.
-- last_check_at / last_check_summary: when the last full check (button or daily run) finished and what it found. Written by the server
-- (service role) only; no new grants for signed-in users, who already read the connection through its existing policy.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.github_connections
  add column last_check_at timestamptz,
  add column last_check_summary text check (char_length(last_check_summary) <= 300);
