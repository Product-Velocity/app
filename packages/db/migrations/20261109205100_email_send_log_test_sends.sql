-- Test sends from the platform Emails area (issue #370, phase 4).
-- A test send goes only to the signed-in platform admin's own address. The log marks it (is_test) and records WHO sent it (actor_id, a
-- user id, never an address) so the per-person hourly limit can be counted. Test sends are left out of the 30-day counts.
-- Replaces public.platform_email_stats (created in 20261109203910_platform_email_stats.sql); no other open branch replaces it.
-- No DROP statements and no row removals.
alter table public.email_send_log add column is_test boolean not null default false;
alter table public.email_send_log add column actor_id uuid references auth.users (id) on delete set null;
create index email_send_log_test_actor on public.email_send_log (actor_id, created_at desc) where is_test;

create or replace function public.platform_email_stats(p_days integer default 30)
returns table (template_key text, sends bigint, failures bigint, delivered bigint, bounced bigint, last_sent timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select l.template_key,
           count(*)::bigint,
           count(*) filter (where l.status = 'failed')::bigint,
           count(*) filter (where l.status = 'delivered')::bigint,
           count(*) filter (where l.status in ('bounced', 'complained'))::bigint,
           max(l.created_at)
      from public.email_send_log l
     where not l.is_test
       and l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
     group by l.template_key
     order by l.template_key;
end $$;
