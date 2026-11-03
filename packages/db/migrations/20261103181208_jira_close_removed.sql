-- Jira: label and close the issue of an initiative that was removed in Product Velocity (decision 2026-11-03-jira-close-removed).
-- Deleting an initiative moves it to the Trash and never touches Jira. After the person confirmed in the Sync with Jira preview, the app
-- labels the issue pv:removed and moves it to a Done status. This migration only REMEMBERS that it was handled:
--   item_jira_links.removed_handled_at   when it was handled (null = not yet: the Trash entry is offered in Sync),
--   item_jira_links.removed_result       closed | labeled (no transition to a Done status exists) | already_done | not_found,
--   item_jira_links.removed_status       the name of the Done status the issue was moved to (closed only; text from Jira, data),
--   jira_project_links.removed_close_status_id   the Done status the person chose for this Jira project, so the next close is preselected.
-- Function (service role only; the app server calls it after the person confirmed and after Jira answered):
--   jira_record_removed(actor, item, result, status_name, status_id)
--     the actor must be a creator or admin of the item's workspace and not a service account; the item must be IN THE TRASH; the link must be
--     in mode 'push' (an issue that came from Jira is never touched); handled once, a second call changes nothing; audited as the person, source UI.
-- Status of an initiative is never written by it (rule 6): only the two link tables change. Functions replaced by this migration: none. No DROP statements.

alter table public.item_jira_links
  add column removed_handled_at timestamptz,
  add column removed_result text check (removed_result is null or removed_result in ('closed', 'labeled', 'already_done', 'not_found')),
  add column removed_status text check (removed_status is null or char_length(removed_status) <= 100),
  add constraint item_jira_links_removed_consistent check ((removed_handled_at is null) = (removed_result is null));

alter table public.jira_project_links
  add column removed_close_status_id text check (removed_close_status_id is null or removed_close_status_id ~ '^[0-9]{1,20}$');

create function public.jira_record_removed(p_actor uuid, p_item uuid, p_result text, p_status_name text default null, p_status_id text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_deleted timestamptz;
  v_link public.item_jira_links%rowtype;
begin
  select tenant_id, deleted_at into v_tenant, v_deleted from public.items where id = p_item;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.jira_sync_actor_ok(p_actor, v_tenant) then
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
