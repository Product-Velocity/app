-- Send log for every product email (issue #370, phase 2).
-- One row per email sent through the registry: which template, what happened, the provider's message id, and (when the email belongs
-- to a workspace) which workspace. NEVER an address, a name, a token, a link or a body. Delivery state arrives from the Resend webhook
-- (matched on provider_id). Nobody reads or writes this table through the API: the server (service role) writes it, and the platform
-- Emails area (phase 3) will read it through a platform-staff function.
-- The log is itself an append-style record of sends, so it has no separate audit trigger. Rows are never updated except for the delivery
-- state and the timestamp of the last event.
-- No DROP statements and no row removals.
create table public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (char_length(template_key) between 3 and 60),
  tenant_id uuid references public.tenants (id) on delete set null,
  status text not null default 'sent' check (status in ('sent', 'failed', 'delivered', 'bounced', 'complained')),
  provider_id text check (char_length(provider_id) <= 100),
  error text check (char_length(error) <= 200),
  created_at timestamptz not null default now(),
  event_at timestamptz
);
create index email_send_log_tenant on public.email_send_log (tenant_id, created_at desc);
create index email_send_log_template on public.email_send_log (template_key, created_at desc);
create index email_send_log_provider on public.email_send_log (provider_id) where provider_id is not null;
alter table public.email_send_log enable row level security;
revoke all on public.email_send_log from public, anon, authenticated;
grant all on public.email_send_log to service_role;
-- the platform read-only guard every tenant table carries (docs/15, platform staff are read-only on tenant tables)
create trigger a_platform_readonly_guard before insert or update or delete on public.email_send_log
  for each row execute function platform.readonly_guard();
