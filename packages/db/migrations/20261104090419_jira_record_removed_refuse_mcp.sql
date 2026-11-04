-- Jira: jira_record_removed also refuses a write whose source is MCP (Claude), like github_record_removed (decision 2026-11-03-github-close-removed, parity).
-- The server action already made this unreachable for Claude; now the database function refuses it too (CLAUDE.md rule 3). Nothing else changes.
-- Functions replaced by this migration: jira_record_removed (same signature and grants). No DROP statements.

create or replace function public.jira_record_removed(p_actor uuid, p_item uuid, p_result text, p_status_name text default null, p_status_id text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_deleted timestamptz;
  v_link public.item_jira_links%rowtype;
begin
  select tenant_id, deleted_at into v_tenant, v_deleted from public.items where id = p_item;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if public.write_source() = 'MCP' or not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can close the Jira issue of a removed initiative.' using errcode = '42501';
  end if;
  if v_deleted is null then raise exception 'The initiative is not in the Trash.' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('closed', 'labeled', 'already_done', 'not_found') then raise exception 'bad result' using errcode = '22023'; end if;
  select * into v_link from public.item_jira_links l where l.tenant_id = v_tenant and l.item_id = p_item for update;
  if not found then raise exception 'This initiative has no Jira link.' using errcode = 'P0002'; end if;
  if v_link.mode <> 'push' then
    raise exception 'The Jira issue came from Jira: Product Velocity never closes it.' using errcode = '42501';
  end if;
  if v_link.removed_handled_at is not null then return; end if; -- handled once; a second call changes nothing
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_jira_links
     set removed_handled_at = now(), removed_result = p_result,
         removed_status = case when p_result = 'closed' then left(nullif(btrim(p_status_name), ''), 100) else null end
   where id = v_link.id;
  -- remember the chosen Done status for this Jira project (only when closed and the id is a Jira status id)
  if p_result = 'closed' and p_status_id is not null and p_status_id ~ '^[0-9]{1,20}$' then
    update public.jira_project_links pl set removed_close_status_id = p_status_id
     where pl.tenant_id = v_tenant and pl.connection_id = v_link.connection_id and pl.site_id = v_link.site_id
       and v_link.issue_key like pl.jira_project_key || '-%';
  end if;
end $$;
revoke all on function public.jira_record_removed(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.jira_record_removed(uuid, uuid, text, text, text) to service_role;
