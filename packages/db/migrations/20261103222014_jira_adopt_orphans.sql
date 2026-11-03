-- Jira: signing in again after a Disconnect must not orphan the project links (issue #67). Disconnect keeps a project's link, its issues and
-- its initiatives' links when any initiative is linked to a Jira issue (jira_disconnect, on purpose), but signing in again creates a NEW connection
-- and nothing moved them over, so the sync saw no linked project and every Read answered "connection not available".
-- jira_adopt_orphans(connection): service role only. Moves the project links, initiative links, light issue records and webhooks of DISCONNECTED
-- connections of the same workspace and the same Jira site onto the given connected one. Rows that would collide with one the new connection
-- already has (same project, same issue key) are left where they are. Returns how many rows moved per table.
-- Runs at the end of this migration for every connected connection, which repairs the workspaces already in this state.
-- Functions replaced by this migration: none. No DROP statements.

create function public.jira_adopt_orphans(p_connection uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_sites text[];
  v_links integer; v_items integer; v_issues integer; v_hooks integer;
begin
  select tenant_id, array (select s ->> 'id' from jsonb_array_elements(sites) s) into v_tenant, v_sites
    from public.jira_connections where id = p_connection and state = 'connected';
  if v_tenant is null then return '{"links":0,"items":0,"issues":0,"webhooks":0}'::jsonb; end if;

  with moved as (
    update public.jira_project_links l set connection_id = p_connection
     where l.tenant_id = v_tenant and l.site_id = any (v_sites)
       and l.connection_id in (select id from public.jira_connections where tenant_id = v_tenant and state = 'disconnected')
       and not exists (select 1 from public.jira_project_links n where n.project_id = l.project_id and n.connection_id = p_connection)
       and not exists (select 1 from public.jira_project_links n where n.tenant_id = v_tenant and n.connection_id = p_connection and n.site_id = l.site_id and n.jira_project_id = l.jira_project_id)
    returning 1) select count(*) into v_links from moved;
  with moved as (
    update public.item_jira_links x set connection_id = p_connection
     where x.tenant_id = v_tenant and x.site_id = any (v_sites)
       and x.connection_id in (select id from public.jira_connections where tenant_id = v_tenant and state = 'disconnected')
       and not exists (select 1 from public.item_jira_links n where n.connection_id = p_connection and n.site_id = x.site_id and n.issue_key = x.issue_key)
    returning 1) select count(*) into v_items from moved;
  with moved as (
    update public.jira_issues j set connection_id = p_connection
     where j.tenant_id = v_tenant and j.site_id = any (v_sites)
       and j.connection_id in (select id from public.jira_connections where tenant_id = v_tenant and state = 'disconnected')
       and not exists (select 1 from public.jira_issues n where n.connection_id = p_connection and n.site_id = j.site_id and n.issue_key = j.issue_key)
    returning 1) select count(*) into v_issues from moved;
  with moved as (
    update public.jira_webhooks w set connection_id = p_connection
     where w.tenant_id = v_tenant and w.site_id = any (v_sites)
       and w.connection_id in (select id from public.jira_connections where tenant_id = v_tenant and state = 'disconnected')
       and exists (select 1 from public.jira_project_links l where l.id = w.link_id and l.connection_id = p_connection)
    returning 1) select count(*) into v_hooks from moved;
  return jsonb_build_object('links', v_links, 'items', v_items, 'issues', v_issues, 'webhooks', v_hooks);
end $$;
revoke all on function public.jira_adopt_orphans(uuid) from public, anon, authenticated;
grant execute on function public.jira_adopt_orphans(uuid) to service_role;

-- repair what is already in this state
select public.jira_adopt_orphans(id) from public.jira_connections where state = 'connected';
