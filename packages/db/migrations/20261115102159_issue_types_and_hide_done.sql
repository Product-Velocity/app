-- 20261115102159_issue_types_and_hide_done: a saved view says which tracker issue types "Show issues" lists, and whether finished issues are hidden (issue #437)
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- issue_types: the issue types shown under each initiative (for example Epic, Story, Task); null means every type. Only meaningful with show_issues.
-- issues_hide_done: hide issues whose tracker status is Done or Cancelled (the Done status category). Default false.
-- No SQL function is replaced. The audit trigger (audit_row) already records every column, old and new value; nothing is rewritten here.
alter table public.saved_views
  add column issue_types text[] check (issue_types is null or (cardinality(issue_types) between 1 and 20 and char_length(array_to_string(issue_types, ',')) <= 400)),
  add column issues_hide_done boolean not null default false;
grant insert (issue_types, issues_hide_done) on public.saved_views to authenticated;
grant update (issue_types, issues_hide_done) on public.saved_views to authenticated;
