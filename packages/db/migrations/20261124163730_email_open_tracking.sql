-- 20261124163730_email_open_tracking: email open counts on the send log, and team-level usage numbers for the platform console (issue #634,
-- decision docs/decisions/2026-11-23-email-open-and-usage-tracking.md).
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- No new table: email_send_log keeps its RLS (nobody reads or writes it through the API; the server uses the service role).
-- Three new functions only; no existing function is replaced. No DROP statements and no row removals.
--
-- What is stored about an open: that it happened, when it first happened and how many times. NEVER an address, a name, an IP address, a browser
-- or a location. The send log itself holds no address, so an open cannot be tied to a person.

alter table public.email_send_log
  add column open_tracked boolean not null default false,        -- the email carried an open-tracking image (only some templates do)
  add column first_opened_at timestamptz,
  add column open_count integer not null default 0 check (open_count >= 0);

-- Records one open. Called by the server (service role) when the image is fetched. Opens in the first 30 seconds are ignored: mail
-- servers and security scanners fetch images the moment a message arrives, and that is not a person reading it.
create function public.record_email_open(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.email_send_log
     set open_count = open_count + 1,
         first_opened_at = coalesce(first_opened_at, now())
   where id = p_id
     and open_tracked
     and created_at < now() - interval '30 seconds';
$$;
revoke all on function public.record_email_open(uuid) from public, anon, authenticated;
grant execute on function public.record_email_open(uuid) to service_role;

-- Per template: how many emails carried the image and how many of those were opened at least once, for the last N days. Platform admins only.
-- Open rates are a floor: some mail programs block images, and some load them in advance.
create function public.platform_email_open_stats(p_days integer default 30)
returns table (template_key text, tracked bigint, opened bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select l.template_key,
           count(*) filter (where l.open_tracked)::bigint,
           count(*) filter (where l.open_tracked and l.first_opened_at is not null)::bigint
      from public.email_send_log l
     where l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
       and l.open_tracked
     group by l.template_key
     order by l.template_key;
end $$;
revoke all on function public.platform_email_open_stats(integer) from public, anon;
grant execute on function public.platform_email_open_stats(integer) to authenticated;

-- Per workspace, for the last N days: how many different people made a change and how many changes were made. Team numbers read from the
-- audit log (rule 5), never a person's name or a ranking of people: only counts. Platform access entries and system changes are left out.
-- Platform admins only.
create function public.platform_usage_stats(p_days integer default 30)
returns table (tenant_id uuid, tenant_name text, people bigint, changes bigint, last_change timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select t.id,
           t.name,
           count(distinct a.actor_id)::bigint,
           count(a.id)::bigint,
           max(a.at)
      from public.tenants t
      left join public.audit_log a
        on a.tenant_id = t.id
       and a.entity <> 'platform_access'
       and a.actor_id is not null
       and a.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
     group by t.id, t.name
     order by count(a.id) desc, t.name;
end $$;
revoke all on function public.platform_usage_stats(integer) from public, anon;
grant execute on function public.platform_usage_stats(integer) to authenticated;
