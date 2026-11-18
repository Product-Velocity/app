-- 20261118133107_change_watch: the top-bar bell counts the changes of every project the person can open, in every account, since they last cleared it.
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- No existing function is replaced and nothing is dropped. The bell's decision-gate inbox (notifications) is unchanged.
--
-- change_watch_clears holds ONE row per person and project: the moment its counter was last reset. The counter is not stored; change_counts() counts the
-- audit_log rows of the same kinds as the Changes report (change_feed: Initiative Phase, Initiative Status, Health, Build Status and the status of the linked
-- GitHub or Jira issue, never a commercial field) newer than that moment, per project and type. A project seen for the first time starts at "now", so
-- nobody opens the bell to thousands of old changes. A person's own changes are not counted (the bell is for what others and the trackers did).
-- The row is personal reading state, like notifications.read_at: written only through clear_change_counts() / change_counts(), never by Claude, not audited.
create table public.change_watch_clears (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  cleared_at timestamptz not null default now(),
  primary key (user_id, tenant_id, project_id),
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade
);
create index change_watch_clears_tenant_idx on public.change_watch_clears (tenant_id, user_id);

alter table public.change_watch_clears enable row level security;
create policy change_watch_clears_select on public.change_watch_clears for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())) and user_id = (select auth.uid()));
revoke all on public.change_watch_clears from public, anon, authenticated;
grant select on public.change_watch_clears to authenticated;
create trigger a_platform_readonly_guard before insert or update or delete on public.change_watch_clears
  for each row execute function platform.readonly_guard();

-- Counts per account, project and type since each project's counter was cleared. Only projects with at least one change are returned. Types are the
-- Changes report's ids: phase, initiative-status, health, build-status, issue-status.
create function public.change_counts()
returns table (tenant_id uuid, tenant_name text, project_id uuid, project_name text, change_type text, n integer, latest_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- first sight of a project: start counting from now
  insert into public.change_watch_clears (user_id, tenant_id, project_id)
    select auth.uid(), p.tenant_id, p.id from public.projects p
    where p.tenant_id = any (array (select public.my_tenant_ids()))
  on conflict do nothing;
  return query
    select t.id, t.name, p.id, p.name, x.change_type, count(*)::integer, max(x.at)
    from (
      select a.tenant_id, a.at, a.actor_id,
             case a.entity when 'items' then a.entity_id when 'item_jira_links' then jl.item_id else gl.item_id end as item_id,
             case when a.entity = 'items' and a.field = 'initiative_phase' then 'phase'
                  when a.entity = 'items' and a.field = 'initiative_status' then 'initiative-status'
                  when a.entity = 'items' and a.field = 'health' then 'health'
                  when a.entity = 'items' and a.field = 'status' then 'build-status'
                  else 'issue-status' end as change_type
      from public.audit_log a
      left join public.item_jira_links jl on a.entity = 'item_jira_links' and jl.id = a.entity_id and jl.tenant_id = a.tenant_id
      left join public.item_github_links gl on a.entity = 'item_github_links' and gl.id = a.entity_id and gl.tenant_id = a.tenant_id
      where a.tenant_id = any (array (select public.my_tenant_ids()))
        and a.at > now() - interval '90 days'
        and ((a.entity = 'items' and a.field in ('initiative_phase', 'initiative_status', 'health', 'status'))
          or (a.entity = 'item_jira_links' and a.field = 'jira_status' and a.old is not null and jl.item_id is not null)
          or (a.entity = 'item_github_links' and a.field = 'gh_state' and a.old is not null and gl.item_id is not null))
        and a.actor_id is distinct from auth.uid()
    ) x
    join public.items i on i.id = x.item_id and i.tenant_id = x.tenant_id and i.deleted_at is null
    join public.projects p on p.id = i.home_project_id and p.tenant_id = i.tenant_id
    join public.tenants t on t.id = p.tenant_id
    join public.change_watch_clears c on c.user_id = auth.uid() and c.tenant_id = p.tenant_id and c.project_id = p.id
    where x.at > c.cleared_at
    group by t.id, t.name, p.id, p.name, x.change_type
    order by max(x.at) desc;
end $$;

-- Resets counters to 0: one project, every project of one account, or (no arguments) everything. A person's own action; never Claude.
create function public.clear_change_counts(p_tenant uuid default null, p_project uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null or public.write_source() = 'MCP' then
    raise exception 'Only a person clears their change counters' using errcode = 'PV004';
  end if;
  update public.change_watch_clears set cleared_at = now()
   where user_id = auth.uid() and tenant_id = any (array (select public.my_tenant_ids()))
     and (p_tenant is null or tenant_id = p_tenant) and (p_project is null or project_id = p_project);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.change_counts(), public.clear_change_counts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.change_counts(), public.clear_change_counts(uuid, uuid) to authenticated;
