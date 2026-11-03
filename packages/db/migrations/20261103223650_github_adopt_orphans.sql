-- GitHub: connecting again after a Disconnect must not orphan the initiative links (decision 2026-11-03-tracker-parity, the twin of
-- jira_adopt_orphans). github_disconnect() marks the connection disconnected and keeps item_github_links, tracker_issues and tracker_rules on it;
-- connecting again creates a NEW connection, and the sync reads those rows by connection id, so it never saw them again.
-- github_adopt_orphans(connection): service role only. Moves the initiative links, the incoming-issue records and the rules of DISCONNECTED
-- connections of the same workspace and the same GitHub account (login compared without case) onto the given connected one. A row that would
-- collide with one the new connection already has is left where it is. Returns how many rows moved per table. Repeatable.
-- Runs at the end of this migration for every connected connection, which repairs workspaces already in this state.
-- Functions replaced by this migration: none. No DROP statements.

create function public.github_adopt_orphans(p_connection uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_login text;
  v_links integer; v_issues integer; v_rules integer;
begin
  select tenant_id, lower(account_login) into v_tenant, v_login
    from public.github_connections where id = p_connection and state = 'connected' and account_login is not null;
  if v_tenant is null then return '{"links":0,"issues":0,"rules":0}'::jsonb; end if;

  with old as (select id from public.github_connections where tenant_id = v_tenant and state = 'disconnected' and lower(account_login) = v_login and id <> p_connection),
  moved as (
    update public.item_github_links l set connection_id = p_connection
     where l.tenant_id = v_tenant and l.connection_id in (select id from old)
       and not exists (select 1 from public.item_github_links n where n.connection_id = p_connection and n.item_id = l.item_id)
       and (l.issue_number is null or not exists (select 1 from public.item_github_links n where n.connection_id = p_connection and lower(n.repo_full_name) = lower(l.repo_full_name) and n.issue_number = l.issue_number))
    returning 1) select count(*) into v_links from moved;
  with old as (select id from public.github_connections where tenant_id = v_tenant and state = 'disconnected' and lower(account_login) = v_login and id <> p_connection),
  moved as (
    update public.tracker_issues t set connection_id = p_connection
     where t.tenant_id = v_tenant and t.connection_id in (select id from old)
       and not exists (select 1 from public.tracker_issues n where n.connection_id = p_connection and n.repo_full_name = t.repo_full_name and n.issue_number = t.issue_number)
    returning 1) select count(*) into v_issues from moved;
  with old as (select id from public.github_connections where tenant_id = v_tenant and state = 'disconnected' and lower(account_login) = v_login and id <> p_connection),
  moved as (
    update public.tracker_rules r set connection_id = p_connection
     where r.tenant_id = v_tenant and r.connection_id in (select id from old)
       and not exists (select 1 from public.tracker_rules n where n.connection_id = p_connection and n.kind = r.kind and n.value = r.value)
    returning 1) select count(*) into v_rules from moved;
  return jsonb_build_object('links', v_links, 'issues', v_issues, 'rules', v_rules);
end $$;
revoke all on function public.github_adopt_orphans(uuid) from public, anon, authenticated;
grant execute on function public.github_adopt_orphans(uuid) to service_role;

-- repair what is already in this state
select public.github_adopt_orphans(id) from public.github_connections where state = 'connected';
