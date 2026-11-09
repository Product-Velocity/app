-- Platform Emails area, read-only (issue #370, phase 3).
-- platform_email_stats(): per template, how many emails were sent and how many failed in the last N days, from the send log
-- (email_send_log, no addresses or text). Platform admins only (platform.require_admin()); the table itself stays unreadable through the API.
-- No DROP statements and no row removals.
create function public.platform_email_stats(p_days integer default 30)
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
     where l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
     group by l.template_key
     order by l.template_key;
end $$;
revoke all on function public.platform_email_stats(integer) from public, anon;
grant execute on function public.platform_email_stats(integer) to authenticated;
