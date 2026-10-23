-- 0027: a sync that finds nothing new writes nothing (scale, docs/18-SCALING.md).
-- Before: every daily check rewrote every light record (tracker_issues) and every linked issue's link row, even when nothing had changed.
-- With millions of records that is constant disk and log traffic, dead rows and bloat for no information.
-- Now both functions write only when a value actually differs. The result of tracker_upsert_issues counts rows written.
-- gh_synced_at now means "when GitHub last told us something new" (the last check of the whole connection is github_connections.last_check_at).
-- create or replace only: no DROP statements, applied through a tool that pauses on them.
create or replace function public.tracker_upsert_issues(p_connection uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.github_connections%rowtype;
  r record;
  v_state text;
  v_reason text;
  v_item uuid;
  v_n integer := 0;
begin
  select * into c from public.github_connections where id = p_connection;
  if not found then raise exception 'Unknown connection.' using errcode = '22023'; end if;
  perform set_config('app.via', 'GitHub webhook', true);
  for r in
    select * from jsonb_to_recordset(p_rows) as x(repo text, number integer, id bigint, title text, type text, labels text[], state text,
                                                  reason text, parent integer, url text, updated_at timestamptz)
  loop
    if exists (select 1 from public.item_issue_tree t where t.tenant_id = c.tenant_id and lower(t.repo_full_name) = lower(r.repo) and t.issue_number = r.number) then
      continue;
    end if;
    update public.tracker_issues x set
      issue_id = coalesce(r.id, x.issue_id), title = left(r.title, 300), issue_type = r.type, labels = coalesce(r.labels, '{}'),
      state = r.state, state_reason = r.reason, parent_number = r.parent, html_url = r.url, gh_updated_at = r.updated_at
     where x.connection_id = p_connection and lower(x.repo_full_name) = lower(r.repo) and x.issue_number = r.number
       and (x.gh_updated_at is null or r.updated_at is null or r.updated_at >= x.gh_updated_at)
       and (x.issue_id, x.title, x.issue_type, x.labels, x.state, x.state_reason, x.parent_number, x.html_url, x.gh_updated_at)
           is distinct from (coalesce(r.id, x.issue_id), left(r.title, 300), r.type, coalesce(r.labels, '{}'), r.state, r.reason, r.parent, r.url, r.updated_at);
    if found then v_n := v_n + 1; continue; end if;
    -- known and unchanged (or older information): nothing to write
    if exists (select 1 from public.tracker_issues y where y.connection_id = p_connection and lower(y.repo_full_name) = lower(r.repo) and y.issue_number = r.number) then continue; end if;

    select l.item_id into v_item from public.item_github_links l
     where l.connection_id = p_connection and lower(l.repo_full_name) = lower(r.repo) and l.issue_number = r.number;
    v_state := 'not_pulled'; v_reason := null;
    if v_item is not null then
      v_state := 'pulled';
    else
      select 'Rule: ' || k.kind || ' ' || k.value into v_reason from public.tracker_rules k
       where k.connection_id = p_connection and k.removed_at is null and k.action = 'ignore'
         and ((k.kind = 'type' and lower(coalesce(r.type, '')) = lower(k.value))
           or (k.kind = 'label' and exists (select 1 from unnest(coalesce(r.labels, '{}')) lb where lower(lb) = lower(k.value)))
           or (k.kind = 'repo' and lower(r.repo) = lower(k.value)))
       order by k.created_at limit 1;
      if v_reason is not null then v_state := 'ignored'; end if;
    end if;
    insert into public.tracker_issues (tenant_id, connection_id, repo_full_name, issue_number, issue_id, title, issue_type, labels, state, state_reason,
                                       parent_number, html_url, pull_state, ignore_reason, item_id, gh_updated_at)
    values (c.tenant_id, p_connection, r.repo, r.number, r.id, left(r.title, 300), r.type, coalesce(r.labels, '{}'), r.state, r.reason, r.parent, r.url,
            v_state, v_reason, v_item, r.updated_at);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.github_apply_issue(
  p_connection uuid, p_repo text, p_number integer, p_issue_id bigint, p_node_id text,
  p_state text, p_state_reason text, p_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_github_links%rowtype;
  v_gh text;
  v_old text;
  v_new text;
  v_sync text;
  v_changes jsonb := '{}'::jsonb;
begin
  if p_state not in ('open', 'closed') then raise exception 'bad issue state' using errcode = '22023'; end if;
  select * into l from public.item_github_links
   where connection_id = p_connection and lower(repo_full_name) = lower(p_repo) and issue_number = p_number
   for update;
  if not found then return null; end if;

  v_gh := case when p_state = 'open' then 'open' when p_state_reason = 'not_planned' then 'closed_not_planned' else 'closed_completed' end;
  if l.gh_last_activity is not null and p_updated_at < l.gh_last_activity then
    return jsonb_build_object('item_id', l.item_id, 'stale', true, 'changes', '{}'::jsonb); -- older than what we already know
  end if;

  v_sync := case when l.mode = 'follow' and coalesce(p_issue_id, l.issue_id) is not null then 'synced' else l.sync_state end;
  -- write the link only when GitHub said something new
  if (l.gh_state, l.gh_last_activity, l.issue_id, l.issue_node_id, l.sync_state, l.last_error)
     is distinct from (v_gh, p_updated_at, coalesce(p_issue_id, l.issue_id), coalesce(p_node_id, l.issue_node_id), v_sync, case when l.mode = 'follow' then null else l.last_error end) then
    update public.item_github_links set
      gh_state = v_gh, gh_last_activity = p_updated_at, gh_synced_at = now(),
      issue_id = coalesce(p_issue_id, issue_id), issue_node_id = coalesce(p_node_id, issue_node_id),
      sync_state = v_sync,
      last_error = case when l.mode = 'follow' then null else l.last_error end
     where id = l.id;
  end if;
  if l.gh_state is distinct from v_gh then v_changes := v_changes || jsonb_build_object('gh_state', jsonb_build_array(l.gh_state, v_gh)); end if;

  select status into v_old from public.items where id = l.item_id;
  v_new := case v_gh
    when 'closed_completed' then 'Completed'
    when 'closed_not_planned' then 'Cancelled'
    else case when l.gh_state in ('closed_completed', 'closed_not_planned') and v_old in ('Completed', 'Cancelled') then 'Not Started' else null end
  end;
  if v_new is null and v_gh = 'open' and v_old is null then v_new := 'Backlog'; end if;
  if v_new is not null and v_new is distinct from v_old then
    update public.items set status = v_new, status_changed_at = now(), last_synced_at = now() where id = l.item_id;
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(v_old, v_new));
  end if;
  return jsonb_build_object('item_id', l.item_id, 'stale', false, 'changes', v_changes);
end $$;
