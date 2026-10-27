-- 0039: an issue that PV pushed must not sit in Incoming as "Not pulled" (the race of a webhook that arrives before the link is saved).
-- Symptom: pulling such an issue in failed with "Could not create the initiative", because it already had an initiative and a link.
-- 1. github_record_push marks the already-recorded issue as pulled when it saves the link.
-- 2. tracker_upsert_issues repairs a record that was left behind (Not pulled or Ignored) when the issue has a link.
-- 3. tracker_pull_in answers "Already linked to R-98." for such an issue instead of failing, and fixes the record.
-- 4. One-off repair of the records that are already wrong.
-- create or replace and one update only: no DROP statements, applied through a tool that pauses on them.
-- 1
create or replace function public.github_record_push(
  p_actor uuid, p_item uuid, p_connection uuid, p_repo text, p_number integer, p_issue_id bigint,
  p_node_id text, p_url text, p_hash text, p_state text, p_error text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can push an item to GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.github_connections c where c.id = p_connection and c.tenant_id = v_tenant and c.state = 'connected') then
    raise exception 'The workspace is not connected to GitHub.' using errcode = '42501';
  end if;
  if p_state not in ('pending', 'synced', 'error') then raise exception 'bad sync state' using errcode = '22023'; end if;
  if exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'follow') then
    raise exception 'This item follows an existing GitHub issue read-only; pushing to it is switched off.' using errcode = 'PV006';
  end if;
  if exists (select 1 from public.github_repositories r where r.tenant_id = v_tenant and r.removed_at is null and r.access = 'read_only' and lower(r.full_name) = lower(p_repo)) then
    raise exception 'The repository % is marked read-only; the app never writes to it.', p_repo using errcode = 'PV007';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who confirmed
  insert into public.item_github_links as l (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, issue_node_id, html_url, sync_state, last_error, last_pushed_hash, last_pushed_at)
  values (v_tenant, p_item, p_connection, p_repo, p_number, p_issue_id, p_node_id, p_url, p_state, left(p_error, 300),
          case when p_state = 'synced' then p_hash end, case when p_state = 'synced' then now() end)
  on conflict (tenant_id, item_id) do update set
    connection_id = excluded.connection_id,
    repo_full_name = excluded.repo_full_name,
    issue_number = coalesce(excluded.issue_number, l.issue_number),
    issue_id = coalesce(excluded.issue_id, l.issue_id),
    issue_node_id = coalesce(excluded.issue_node_id, l.issue_node_id),
    html_url = coalesce(excluded.html_url, l.html_url),
    sync_state = excluded.sync_state,
    last_error = excluded.last_error,
    last_pushed_hash = case when excluded.sync_state = 'synced' then excluded.last_pushed_hash else l.last_pushed_hash end,
    last_pushed_at = case when excluded.sync_state = 'synced' then now() else l.last_pushed_at end
  returning id into v_id;
  -- GitHub may have announced the new issue before this link existed, so it sits in Incoming as "Not pulled": it is this initiative's
  if p_number is not null then
    update public.tracker_issues x set pull_state = 'pulled', item_id = p_item, ignore_reason = null
     where x.connection_id = p_connection and lower(x.repo_full_name) = lower(p_repo) and x.issue_number = p_number
       and (x.pull_state <> 'pulled' or x.item_id is distinct from p_item);
  end if;
  return v_id;
end $$;

-- 2
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
    if exists (select 1 from public.tracker_issues y where y.connection_id = p_connection and lower(y.repo_full_name) = lower(r.repo) and y.issue_number = r.number) then
      -- a record left as Not pulled or Ignored for an issue that has an initiative (its link was saved after the first sighting) is repaired
      update public.tracker_issues y set pull_state = 'pulled', item_id = l.item_id, ignore_reason = null
        from public.item_github_links l
       where y.connection_id = p_connection and lower(y.repo_full_name) = lower(r.repo) and y.issue_number = r.number
         and l.connection_id = p_connection and lower(l.repo_full_name) = lower(r.repo) and l.issue_number = r.number
         and (y.pull_state <> 'pulled' or y.item_id is distinct from l.item_id);
      if found then v_n := v_n + 1; end if;
      continue;
    end if;

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

-- 3
create or replace function public.tracker_pull_in(p_ids uuid[], p_project uuid)
returns table (id uuid, ok boolean, reason text, item_id uuid, item_code text)
language plpgsql security definer set search_path = '' as $$
declare
  t public.tracker_issues%rowtype;
  v_id uuid;
  v_item uuid;
  v_code text;
  v_tenant uuid;
begin
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'Up to 200 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  select p.tenant_id into v_tenant from public.projects p where p.id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot add initiatives to that project.' using errcode = '42501';
  end if;
  if exists (select 1 from public.projects pr where pr.id = p_project and pr.tracker is not null and pr.tracker <> 'github') then
    raise exception 'That project is linked to another tracker, so it cannot take GitHub issues.' using errcode = 'PV008';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    select * into t from public.tracker_issues x where x.id = v_id and x.tenant_id = v_tenant for update;
    if not found then return query select v_id, false, 'Issue not found.'::text, null::uuid, null::text; continue; end if;
    if t.pull_state = 'pulled' and exists (select 1 from public.items i where i.id = t.item_id) then
      return query select v_id, false, 'Already an initiative.'::text, null::uuid, null::text; continue;
    end if;
    -- the issue already has an initiative (for example one PV pushed): say so, fix the record, and do not create a second one
    select l.item_id, i.item_code into v_item, v_code from public.item_github_links l join public.items i on i.id = l.item_id
     where l.connection_id = t.connection_id and lower(l.repo_full_name) = lower(t.repo_full_name) and l.issue_number = t.issue_number and i.deleted_at is null;
    if found then
      update public.tracker_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, false, ('Already linked to ' || v_code || '.')::text, null::uuid, null::text; continue;
    end if;
    begin
      insert into public.items (tenant_id, home_project_id, initiative_name, source)
      values (v_tenant, p_project, left(t.title, 200), 'GitHub issue #' || t.issue_number)
      returning items.id, items.item_code into v_item, v_code;
      insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode, gh_closed_at)
      values (v_tenant, v_item, t.connection_id, t.repo_full_name, t.issue_number, t.issue_id, coalesce(t.html_url, 'https://github.com/' || t.repo_full_name || '/issues/' || t.issue_number), 'synced', 'follow',
              case when t.state = 'closed' then t.gh_updated_at end);
      perform public.github_apply_issue(t.connection_id, t.repo_full_name, t.issue_number, t.issue_id, null, t.state,
                                        t.state_reason, coalesce(t.gh_updated_at, now()));
      update public.tracker_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, true, null::text, v_item, v_code;
    exception
      when unique_violation then
        return query select v_id, false, 'This issue is already linked to an initiative.'::text, null::uuid, null::text;
      when others then
        return query select v_id, false, 'Could not create the initiative.'::text, null::uuid, null::text;
    end;
  end loop;
end $$;

-- 4. the records that are wrong today
select set_config('app.via', 'system', true);
update public.tracker_issues x set pull_state = 'pulled', item_id = l.item_id, ignore_reason = null
  from public.item_github_links l
 where l.connection_id = x.connection_id and lower(l.repo_full_name) = lower(x.repo_full_name) and l.issue_number = x.issue_number
   and (x.pull_state <> 'pulled' or x.item_id is distinct from l.item_id);
