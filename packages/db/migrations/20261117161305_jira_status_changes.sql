-- Who moved a Jira issue to a status, and when (issue #472, Ashu 2026-11-17: "record the Jira user name as well and show it as a column"; found while explaining R-72,
-- whose Jira status was moved four times in one day with nobody named). One row per status change in Jira's own history of an issue linked to an initiative:
-- Jira's time (history.created, not the time Product Velocity learned of it), the status before and after, and the display name of the Jira user.
-- Read from Jira's change history (never from a webhook body, which is only a hint: decision 2026-11-03-jira-webhooks.md), so a forged delivery cannot name anyone.
-- Written ONLY by the service role (app server, daily check and webhook); members of the workspace read, nobody signed in writes. The same history also fills in
-- changes made before this table existed, so names appear for past changes of an issue the first time its history is read.
-- Personal data of Jira users (a display name; no email, no account id): kept for as long as the workspace exists, shown on a row of the Changes report only, never
-- counted, ranked or grouped per person (CLAUDE.md rule 8). Retention and the notice to workspace admins are on docs/14-GO-LIVE-CHECKLIST.md.
-- No audit trigger: it is itself a log of what Jira says (like jira_sync_events). Row-level security with the fast policy pattern and an index starting with tenant_id.
-- Functions replaced by this migration: none. No DROP statements.
create table public.jira_status_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  issue_key text not null check (issue_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  changed_at timestamptz not null,
  from_status text check (char_length(from_status) <= 100),
  to_status text not null check (char_length(to_status) between 1 and 100),
  actor_name text check (char_length(actor_name) between 1 and 120),
  recorded_at timestamptz not null default now(),
  unique (tenant_id, issue_key, changed_at, to_status)
);
create index jira_status_changes_tenant_idx on public.jira_status_changes (tenant_id, issue_key, changed_at desc);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_status_changes
  for each row execute function platform.readonly_guard();
alter table public.jira_status_changes enable row level security;
create policy jira_status_changes_select on public.jira_status_changes for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_status_changes from public, anon, authenticated;
grant select on public.jira_status_changes to authenticated;
grant all on public.jira_status_changes to service_role;
