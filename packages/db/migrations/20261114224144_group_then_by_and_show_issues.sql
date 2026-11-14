-- 20261114224144_group_then_by_and_show_issues: a saved view can group by two fields and show tracker issues under each initiative (issue #437)
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- then_by: the second grouping level inside each group (only meaningful with group_by; the application drops it otherwise).
-- show_issues: the grid shows the linked tracker issues (epics, stories, tasks) under each initiative.
-- No SQL function is replaced. The audit trigger (audit_row) already records every column, old and new value; nothing is rewritten here.
alter table public.saved_views
  add column then_by text check (char_length(then_by) between 1 and 80),
  add column show_issues boolean not null default false;
grant insert (then_by, show_issues) on public.saved_views to authenticated;
grant update (then_by, show_issues) on public.saved_views to authenticated;
