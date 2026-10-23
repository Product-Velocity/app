-- 0024: epics and tasks as sub-issues, the Traditional breakdown route and delivery progress (issue #34).
-- item_issue_tree: a read-only cache of the GitHub issues under an initiative's tracking issue (level 1 = epic, level 2 = task).
--   Rebuilt from GitHub by the server (webhook, reconcile, push) through github_apply_tree(); nobody signed in writes it.
--   It holds titles and logins GitHub already shows, never commercial fields. It is derived data, so rows are not audited one by one;
--   the item columns the tree feeds (issues_total, issues_closed, delivery_progress_pct, ...) are audited with the source "GitHub webhook".
-- items: the tracker-driven delivery columns of the field dictionary (read-only in the app, no grant to signed-in users).
--   Delivery progress is provisional until Breakdown Status is Complete; Planned Scope is frozen then, Scope Added counts later growth.
-- item_complete_breakdown(): the "Mark breakdown complete" button; creators and admins only.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items
  add column gh_state text check (gh_state in ('Open', 'Closed (completed)', 'Closed (not planned)')),
  add column gh_last_activity timestamptz,
  add column issues_total integer check (issues_total >= 0),
  add column issues_closed integer check (issues_closed >= 0),
  add column breakdown_route text check (breakdown_route in ('Traditional', 'In between', 'Full Claude')),
  add column breakdown_status text check (breakdown_status in ('Not started', 'Draft proposed', 'Awaiting engineering', 'Complete')),
  add column breakdown_completed_at timestamptz;

create table public.item_issue_tree (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  issue_number integer not null check (issue_number > 0),
  issue_id bigint,
  parent_number integer check (parent_number > 0),
  level smallint not null check (level in (1, 2)),
  title text not null check (char_length(title) <= 200),
  state text not null check (state in ('open', 'closed')),
  state_reason text,
  closed_at timestamptz,
  assignees text[] not null default '{}',
  created_by text not null default 'engineer' check (created_by in ('app', 'claude', 'engineer')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  unique (item_id, repo_full_name, issue_number)
);
create index item_issue_tree_tenant_item on public.item_issue_tree (tenant_id, item_id);

alter table public.item_issue_tree enable row level security;
create policy item_issue_tree_select on public.item_issue_tree for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.item_issue_tree from public, anon, authenticated;
grant select on public.item_issue_tree to authenticated;
grant all on public.item_issue_tree to service_role;

-- p_nodes: [{repo, number, id, parent, level, title, state, reason, closed_at, assignees[], created_by}]; p_total/p_closed/p_pct come from the
-- one counting rule in @pv/github (leaves only, not-planned work out of the total).
create function public.github_apply_tree(p_connection uuid, p_item uuid, p_nodes jsonb, p_total integer, p_closed integer, p_pct integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_github_links%rowtype;
  i public.items%rowtype;
  v_gh text;
begin
  select * into l from public.item_github_links where connection_id = p_connection and item_id = p_item for update;
  if not found then raise exception 'That initiative is not linked to this connection.' using errcode = '22023'; end if;
  perform set_config('app.via', 'GitHub webhook', true);

  delete from public.item_issue_tree t
   where t.item_id = p_item
     and not exists (select 1 from jsonb_to_recordset(p_nodes) as n(repo text, number integer) where n.repo = t.repo_full_name and n.number = t.issue_number);
  insert into public.item_issue_tree (tenant_id, item_id, repo_full_name, issue_number, issue_id, parent_number, level, title, state, state_reason, closed_at, assignees, created_by)
  select l.tenant_id, p_item, n.repo, n.number, n.id, n.parent, n.level, left(n.title, 200), n.state, n.reason, n.closed_at,
         coalesce(n.assignees, '{}'), coalesce(n.created_by, 'engineer')
    from jsonb_to_recordset(p_nodes) as n(repo text, number integer, id bigint, parent integer, level smallint, title text, state text, reason text, closed_at timestamptz, assignees text[], created_by text)
  on conflict (item_id, repo_full_name, issue_number) do update set
    issue_id = excluded.issue_id, parent_number = excluded.parent_number, level = excluded.level, title = excluded.title, state = excluded.state,
    state_reason = excluded.state_reason, closed_at = excluded.closed_at, assignees = excluded.assignees, created_by = excluded.created_by, updated_at = now();

  select * into i from public.items where id = p_item for update;
  v_gh := case l.gh_state when 'open' then 'Open' when 'closed_completed' then 'Closed (completed)' when 'closed_not_planned' then 'Closed (not planned)' end;
  update public.items set
    gh_state = v_gh, gh_last_activity = l.gh_last_activity,
    issues_total = p_total, issues_closed = p_closed, delivery_progress_pct = p_pct,
    -- a tracking issue we pushed starts the Traditional route: engineers write the breakdown
    breakdown_route = coalesce(i.breakdown_route, case when l.mode = 'push' then 'Traditional' end),
    breakdown_status = coalesce(i.breakdown_status, case when l.mode = 'push' then 'Awaiting engineering' end),
    scope_added = case when i.breakdown_status = 'Complete' and i.planned_scope is not null then greatest(p_total - i.planned_scope, 0) end,
    last_synced_at = now()
   where id = p_item;
end $$;
revoke all on function public.github_apply_tree(uuid, uuid, jsonb, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.github_apply_tree(uuid, uuid, jsonb, integer, integer, integer) to service_role;

create function public.item_complete_breakdown(p_item uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.items%rowtype;
begin
  select * into i from public.items where id = p_item and deleted_at is null for update;
  if not found or i.tenant_id <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot change this initiative.' using errcode = '42501';
  end if;
  if i.breakdown_status = 'Complete' then return; end if;
  update public.items set breakdown_status = 'Complete', breakdown_completed_at = now(),
         breakdown_route = coalesce(breakdown_route, 'Traditional'),
         planned_scope = coalesce(issues_total, 0), scope_added = 0
   where id = p_item;
end $$;
revoke all on function public.item_complete_breakdown(uuid) from public, anon;
grant execute on function public.item_complete_breakdown(uuid) to authenticated;
