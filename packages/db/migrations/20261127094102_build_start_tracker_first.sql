-- Build started comes from the tracker first (issue 735, Ashu 2026-11-27: "take the Jira-derived date as the start; Product Velocity is the fallback").
-- Start Building holds the tracker's own date when the tracker has one (the Jira sync writes it, replacing a typed date; the phase move only fills it when it is empty),
-- but item_build_cycle() preferred the day the initiative moved to Build in Product Velocity (the audit log), which could be AFTER the epics were done
-- (R-102: started 24 Nov, completed 17 Nov). Now Start Building wins and the first move to Build is the fallback; when Start Building is only the day of that move (the phase move copies today into it) the exact moment of the move is kept, as before. Only that one expression changes.
-- Function replaced (same signature, columns and checks, so the grants stay): public.item_build_cycle(uuid), last replaced by 20261124203310_jira_epic_build_dates.sql.
-- No other open branch replaces it (checked against the open pull requests on 2026-11-27). No DROP statements.

create or replace function public.item_build_cycle(p_tenant uuid)
returns table (item_id uuid, build_started_at timestamptz, build_completed_at timestamptz, build_days numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select s.id, s.started, s.completed,
           -- Start Building is a date (counted from the start of that day), so a same-day finish is never negative
           case when s.started is not null and s.completed is not null and s.completed::date >= s.started::date
                then round(greatest(extract(epoch from (s.completed - s.started)), 0) / 86400, 2) end
    from (
      select i.id,
             -- the tracker's Start Building wins; when it is empty, or only the day of the move to Build (the phase move copies today into it), the exact moment of the first move is kept
             case when i.start_building is not null and i.start_building is distinct from (m.moved at time zone 'UTC')::date
                  then (i.start_building::timestamp at time zone 'UTC')
                  else coalesce(m.moved, (i.start_building::timestamp at time zone 'UTC')) end as started,
             coalesce(
               (select l.gh_closed_at from public.item_github_links l
                 where l.tenant_id = p_tenant and l.item_id = i.id and l.gh_state = 'closed_completed'),
               (select j.jira_resolved_at from public.item_jira_links j
                 where j.tenant_id = p_tenant and j.item_id = i.id and j.jira_status_category = 'done'),
               public.epics_build_end(p_tenant, i.id)) as completed
      from public.items i
      left join lateral (select min(a.at) as moved from public.audit_log a
                          where a.tenant_id = p_tenant and a.entity = 'items' and a.entity_id = i.id
                            and a.field = 'initiative_phase' and a.new = to_jsonb('Build'::text)) m on true
      where i.tenant_id = p_tenant and i.deleted_at is null
    ) s;
end $$;
