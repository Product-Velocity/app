-- Jira, the "recent events" of the Sync card (decision 2026-11-03-tracker-parity): the Jira twin of sync_events (GitHub). One row per thing that
-- happened automatically or when an admin pressed "Check Jira now": a webhook delivery that changed a linked initiative, an issue found changed by
-- the check, a failure, and one "check" row per run (the "Last check" line). Written by the service role only (source 'system'); members read.
-- No audit trigger: it is itself a log, and what it records (Build Status and Jira status of an initiative) is audited by jira_apply_statuses.
-- Pruned after 90 days by the daily check. Row-level security with the fast policy pattern and an index starting with tenant_id.
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_sync_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  link_id uuid references public.jira_project_links (id) on delete set null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('webhook', 'check', 'manual')),
  kind text not null default 'change' check (kind in ('change', 'run')),
  issue_key text check (issue_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  summary text not null check (char_length(summary) <= 400),
  state text not null default 'processed' check (state in ('processed', 'error')),
  last_error text check (char_length(last_error) <= 300),
  attempts integer not null default 1
);
create index jira_sync_events_tenant_idx on public.jira_sync_events (tenant_id, received_at desc);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_sync_events
  for each row execute function platform.readonly_guard();
alter table public.jira_sync_events enable row level security;
create policy jira_sync_events_select on public.jira_sync_events for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_sync_events from public, anon, authenticated;
grant select on public.jira_sync_events to authenticated;
grant all on public.jira_sync_events to service_role;
