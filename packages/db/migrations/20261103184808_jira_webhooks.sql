-- Jira webhooks (spike J3, issue #257, #67): automated status updates. One webhook per linked Jira project, registered by the daily check
-- with the Atlassian REST API (needs the scope manage:jira-webhook) and extended before its 30 days run out.
-- jira_webhooks: which webhook belongs to which project link, when it expires, and the SHA-256 of the secret that is part of the callback URL
--   (Jira does not sign deliveries of these webhooks as far as known, so the unguessable URL is the credential; only its hash is stored).
--   The delivery is only a hint: the receiver re-reads the issue from Jira and applies it through jira_apply_statuses, so a forged, duplicated,
--   late or out-of-order delivery can change nothing that Jira does not say. Written by the service role only; tenant members read.
-- No audit trigger: the rows hold no business data; the status changes themselves are audited by jira_apply_statuses (source 'system').
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_webhooks (
  link_id uuid primary key references public.jira_project_links (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  site_id text not null check (length(site_id) between 1 and 64),
  jira_webhook_id text check (jira_webhook_id ~ '^[0-9]{1,20}$'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'active' check (state in ('active', 'needs_scope', 'failed')),
  expires_at timestamptz,
  last_event_at timestamptz,
  events_received integer not null default 0,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.jira_connections (tenant_id, id) on delete cascade
);
create index jira_webhooks_tenant_idx on public.jira_webhooks (tenant_id, connection_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_webhooks
  for each row execute function platform.readonly_guard();
alter table public.jira_webhooks enable row level security;
create policy jira_webhooks_select on public.jira_webhooks for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_webhooks from public, anon, authenticated;
-- members read the state; the hash of a 192-bit random secret cannot be reversed into the address
grant select on public.jira_webhooks to authenticated;
grant all on public.jira_webhooks to service_role;
