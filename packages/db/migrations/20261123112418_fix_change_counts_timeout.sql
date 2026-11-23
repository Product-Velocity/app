-- 20261123112418_fix_change_counts_timeout: the top-bar bell's change_counts() hit the statement timeout in production ("Could not read changes (canceling statement due to statement timeout)").
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
--
-- Cause: one query joined audit_log to both link tables with an OR over three different kinds of row, with auth.uid() and my_tenant_ids() inside it. The planner
-- guessed three rows, picked a nested loop of every item against the audit log and ran for seconds (4.6 s on production with 62,000 audit rows, for a member with no changes at all).
-- Fix: the person and their accounts are read once; each of the three kinds of change is read on its own and starts from a small partial index; the rest of the
-- join (item, project, counter) runs on those few rows. Same columns, same rules, same result as 20261118133107_change_watch: nothing is dropped, only this one function is replaced.

-- The audit rows the bell can ever count (Initiative Phase, Initiative Status, Health, Build Status, linked-issue status), by account and time.
create index audit_log_change_feed_idx on public.audit_log (tenant_id, at desc)
  where (entity = 'items' and field in ('initiative_phase', 'initiative_status', 'health', 'status'))
     or (entity = 'item_jira_links' and field = 'jira_status')
     or (entity = 'item_github_links' and field = 'gh_state');

create or replace function public.change_counts()
returns table (tenant_id uuid, tenant_name text, project_id uuid, project_name text, change_type text, n integer, latest_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  tids uuid[];
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  tids := array (select public.my_tenant_ids());
  -- first sight of a project: start counting from now
  insert into public.change_watch_clears (user_id, tenant_id, project_id)
    select me, p.tenant_id, p.id from public.projects p
    where p.tenant_id = any (tids)
  on conflict do nothing;
  return query
    with feed as materialized (
      select a.tenant_id, a.at, a.entity_id as item_id,
             case a.field when 'initiative_phase' then 'phase' when 'initiative_status' then 'initiative-status' when 'health' then 'health' else 'build-status' end as change_type
        from public.audit_log a
       where a.tenant_id = any (tids) and a.at > now() - interval '90 days'
         and a.entity = 'items' and a.field in ('initiative_phase', 'initiative_status', 'health', 'status')
         and a.actor_id is distinct from me
      union all
      select a.tenant_id, a.at, jl.item_id, 'issue-status'
        from public.audit_log a
        join public.item_jira_links jl on jl.id = a.entity_id and jl.tenant_id = a.tenant_id
       where a.tenant_id = any (tids) and a.at > now() - interval '90 days'
         and a.entity = 'item_jira_links' and a.field = 'jira_status' and a.old is not null
         and a.actor_id is distinct from me
      union all
      select a.tenant_id, a.at, gl.item_id, 'issue-status'
        from public.audit_log a
        join public.item_github_links gl on gl.id = a.entity_id and gl.tenant_id = a.tenant_id
       where a.tenant_id = any (tids) and a.at > now() - interval '90 days'
         and a.entity = 'item_github_links' and a.field = 'gh_state' and a.old is not null
         and a.actor_id is distinct from me
    )
    select t.id, t.name, p.id, p.name, x.change_type, count(*)::integer, max(x.at)
    from feed x
    join public.items i on i.id = x.item_id and i.tenant_id = x.tenant_id and i.deleted_at is null
    join public.projects p on p.id = i.home_project_id and p.tenant_id = i.tenant_id
    join public.tenants t on t.id = p.tenant_id
    join public.change_watch_clears c on c.user_id = me and c.tenant_id = p.tenant_id and c.project_id = p.id
    where x.at > c.cleared_at
    group by t.id, t.name, p.id, p.name, x.change_type
    order by max(x.at) desc;
end $$;

revoke all on function public.change_counts() from public, anon, authenticated;
grant execute on function public.change_counts() to authenticated;
