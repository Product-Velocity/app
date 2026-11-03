-- Jira, children of a linked initiative (issue #67, #71): the Jira twin of item_issue_tree + github_apply_tree (migration 0024, docs/04).
-- An initiative linked to a Jira issue (an Epic, say) mirrors the issue's children, read only, and rolls them up into delivery progress.
-- Breakdown lives in the tracker: Product Velocity never creates epics or tasks, and nothing here is ever written to Jira.
-- item_jira_tree: level 1 = a child of the linked issue (Feature, Task, Story, Bug...), level 2 = a sub-task of such a child. Key, title, type,
--   status name, status CATEGORY, assignee display name, link, Jira's updated time and the order Jira returned them in (position).
--   Derived data, rebuilt from Jira only through jira_apply_tree() (service role); nobody signed in writes it, so the rows are not audited one by
--   one; the item columns the tree feeds (issues_total, issues_closed, delivery_progress_pct) ARE audited, source 'system', old and new value.
--   Row-level security: tenant members read; the fast policy pattern and an index starting with tenant_id; the platform read-only guard.
-- jira_issues.child_of_item: the light record of an issue that is part of an initiative's tree is not a new item. Set by jira_apply_tree, cleared
--   when the issue leaves the tree; every list and count of "new items" filters child_of_item is null. Issues already pulled in keep their state.
-- jira_apply_tree(connection, site, item, nodes, total, closed, pct): service role only. Replaces the item's rows (rows Jira no longer returns go,
--   changed rows are updated, identical rows are not written), marks the light records and writes the roll-up on the item: compare before write,
--   so an unchanged tree adds no audit rows; a tree that stays empty never writes zeros over an empty roll-up. The counts come from the one rule
--   in apps/web/src/lib/atlassian/jira-tree.ts (counted at the leaves: a child counts only while it has no sub-tasks; the done CATEGORY = closed).
--   Initiative Status and Build Status are never touched here (rule 6: a closed child means the build is progressing, never that the initiative is done).
-- Functions replaced by this migration: public.jira_issue_counts (create or replace: the same columns, children left out of the counts). No other
--   open branch replaces it (checked 2026-11-03). No DROP statements.

alter table public.jira_issues add column child_of_item uuid references public.items (id) on delete set null;
create index jira_issues_child_of on public.jira_issues (tenant_id, child_of_item) where child_of_item is not null;

create table public.item_jira_tree (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  issue_key text not null check (issue_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  issue_id text check (issue_id ~ '^[0-9]{1,20}$'),
  parent_key text not null check (parent_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  level smallint not null check (level in (1, 2)),
  position integer not null default 0 check (position >= 0),
  title text not null check (char_length(title) <= 300),
  issue_type text check (char_length(issue_type) <= 80),
  status text check (char_length(status) <= 100),
  status_category text check (status_category in ('new', 'indeterminate', 'done')),
  assignee text check (char_length(assignee) <= 100),
  html_url text check (html_url is null or html_url ~ '^https://'),
  jira_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  unique (item_id, issue_key)
);
create index item_jira_tree_tenant_item on public.item_jira_tree (tenant_id, item_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.item_jira_tree
  for each row execute function platform.readonly_guard();

alter table public.item_jira_tree enable row level security;
create policy item_jira_tree_select on public.item_jira_tree for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.item_jira_tree from public, anon, authenticated;
grant select on public.item_jira_tree to authenticated;
grant all on public.item_jira_tree to service_role;

-- p_nodes: [{key, id, parent, level, position, title, type, status, category, assignee, url, updated}], at most 500
create function public.jira_apply_tree(p_connection uuid, p_site text, p_item uuid, p_nodes jsonb, p_total integer, p_closed integer, p_pct integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_jira_links%rowtype;
  i public.items%rowtype;
  v_keys text[];
  v_nodes jsonb;
  v_deleted integer;
  v_upserted integer;
  v_rolled boolean := false;
begin
  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) > 500 then raise exception 'Up to 500 issues per initiative.' using errcode = '22023'; end if;
  if p_total is null or p_total < 0 or p_closed is null or p_closed < 0 or p_closed > p_total or (p_pct is not null and (p_pct < 0 or p_pct > 100)) then
    raise exception 'The counts do not add up.' using errcode = '22023';
  end if;
  select * into l from public.item_jira_links x where x.item_id = p_item and x.connection_id = p_connection and x.site_id = p_site for update;
  if not found then raise exception 'That initiative is not linked to this Jira connection.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);

  -- only well-formed nodes are used (Jira text is data: lengths cut, keys and urls checked)
  select coalesce(jsonb_agg(jsonb_build_object('key', n.key, 'id', n.id, 'parent', n.parent, 'level', n.level, 'position', coalesce(n.position, 0), 'title', left(n.title, 300),
                  'type', left(n.type, 80), 'status', left(n.status, 100), 'category', n.category, 'assignee', left(n.assignee, 100), 'url', n.url, 'updated', n.updated)), '[]'::jsonb)
    into v_nodes
    from jsonb_to_recordset(p_nodes) as n(key text, id text, parent text, level smallint, position integer, title text, type text, status text, category text, assignee text, url text, updated timestamptz)
   where n.key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$' and n.parent ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'
     and n.level in (1, 2) and n.key <> l.issue_key and n.title is not null
     and (n.category is null or n.category in ('new', 'indeterminate', 'done'))
     and (n.id is null or n.id ~ '^[0-9]{1,20}$') and (n.url is null or n.url ~ '^https://');
  select coalesce(array_agg(x.key), '{}') into v_keys from jsonb_to_recordset(v_nodes) as x(key text);

  delete from public.item_jira_tree t where t.item_id = p_item and t.issue_key <> all (v_keys);
  get diagnostics v_deleted = row_count;
  insert into public.item_jira_tree as t (tenant_id, item_id, issue_key, issue_id, parent_key, level, position, title, issue_type, status, status_category, assignee, html_url, jira_updated_at)
  select l.tenant_id, p_item, n.key, n.id, n.parent, n.level, n.position, n.title, n.type, n.status, n.category, n.assignee, n.url, n.updated from jsonb_to_recordset(v_nodes) as n(key text, id text, parent text, level smallint, position integer, title text, type text, status text, category text, assignee text, url text, updated timestamptz)
  on conflict (item_id, issue_key) do update set
    issue_id = excluded.issue_id, parent_key = excluded.parent_key, level = excluded.level, position = excluded.position, title = excluded.title,
    issue_type = excluded.issue_type, status = excluded.status, status_category = excluded.status_category, assignee = excluded.assignee,
    html_url = excluded.html_url, jira_updated_at = excluded.jira_updated_at, updated_at = now()
  where (t.issue_id, t.parent_key, t.level, t.position, t.title, t.issue_type, t.status, t.status_category, t.assignee, t.html_url, t.jira_updated_at)
        is distinct from (excluded.issue_id, excluded.parent_key, excluded.level, excluded.position, excluded.title, excluded.issue_type, excluded.status, excluded.status_category, excluded.assignee, excluded.html_url, excluded.jira_updated_at);
  get diagnostics v_upserted = row_count;

  -- the light records of the children are not new items; the ones that left the tree are offered again (an item already pulled in is left alone)
  update public.jira_issues j set child_of_item = null where j.child_of_item = p_item and j.issue_key <> all (v_keys);
  update public.jira_issues j set child_of_item = p_item
   where j.connection_id = p_connection and j.site_id = p_site and j.issue_key = any (v_keys) and j.pull_state <> 'pulled' and j.child_of_item is distinct from p_item;

  select * into i from public.items x where x.id = p_item and x.deleted_at is null for update;
  if found and not (p_total = 0 and i.issues_total is null and i.issues_closed is null and i.delivery_progress_pct is null)
     and (i.issues_total, i.issues_closed, i.delivery_progress_pct) is distinct from (p_total, p_closed, p_pct) then
    update public.items set issues_total = p_total, issues_closed = p_closed, delivery_progress_pct = p_pct, last_synced_at = now() where id = p_item;
    v_rolled := true;
  end if;
  return jsonb_build_object('nodes', jsonb_array_length(p_nodes), 'removed', v_deleted, 'written', v_upserted, 'rolled_up', v_rolled);
end $$;
revoke all on function public.jira_apply_tree(uuid, text, uuid, jsonb, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.jira_apply_tree(uuid, text, uuid, jsonb, integer, integer, integer) to service_role;

create or replace function public.jira_issue_counts() returns table (project_id uuid, pull_state text, n bigint)
language sql stable set search_path = '' as $$
  select i.project_id, i.pull_state, count(*) from public.jira_issues i where i.child_of_item is null group by i.project_id, i.pull_state
$$;
