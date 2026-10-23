-- 0023: Initiative Status and Build Status are two fields (Ashu, 2026-10-23).
-- A closed ticket (GitHub, later Jira) means the BUILD is complete: that is Build Status (items.status, driven by the tracker, read-only
-- in the app) and Build Completed (item_github_links.gh_closed_at). Whether the initiative itself is delivered, adopted and measured is a
-- human judgement: items.initiative_status, set by people only, never by a tracker.
-- item_build_cycle(): per item, when the build started (the Initiative Phase first became Build, from the audit log), when it completed
--   (the linked ticket closed as completed) and the days between: the build time.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items add column initiative_status text
  check (initiative_status in ('Backlog', 'Not Started', 'In Progress', 'Paused', 'Completed', 'Cancelled'));
grant insert (initiative_status) on public.items to authenticated;
grant update (initiative_status) on public.items to authenticated;

alter table public.item_github_links add column gh_closed_at timestamptz;

create function public.item_build_cycle(p_tenant uuid)
returns table (item_id uuid, build_started_at timestamptz, build_completed_at timestamptz, build_days numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select s.id, s.started, s.completed,
           case when s.started is not null and s.completed is not null and s.completed >= s.started
                then round(extract(epoch from (s.completed - s.started)) / 86400, 2) end
    from (
      select i.id,
             (select min(a.at) from public.audit_log a
               where a.tenant_id = p_tenant and a.entity = 'items' and a.entity_id = i.id
                 and a.field = 'initiative_phase' and a.new = to_jsonb('Build'::text)) as started,
             (select l.gh_closed_at from public.item_github_links l
               where l.tenant_id = p_tenant and l.item_id = i.id and l.gh_state = 'closed_completed') as completed
      from public.items i
      where i.tenant_id = p_tenant and i.deleted_at is null
    ) s;
end $$;
revoke all on function public.item_build_cycle(uuid) from public, anon;
grant execute on function public.item_build_cycle(uuid) to authenticated;
