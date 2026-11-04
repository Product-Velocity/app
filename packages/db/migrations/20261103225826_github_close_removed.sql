-- GitHub: label and close the issue of an initiative that was removed in Product Velocity (decision 2026-11-03-github-close-removed; the twin of
-- 20261103181208_jira_close_removed.sql). Deleting an initiative moves it to the Trash and never touches GitHub. After the person confirmed in the
-- Sync with GitHub dialog, the app labels the issue pv:removed and closes it as "not planned". This migration only REMEMBERS that it was handled:
--   item_github_links.removed_handled_at   when it was handled (null = not yet: the Trash entry is offered in Sync),
--   item_github_links.removed_result       closed (closed as not planned) | already_done (the issue was closed already: label only) | not_found (GitHub no longer has it),
--   item_github_links.removed_reason       the state_reason the issue was closed with (closed only; always 'not_planned' today).
-- Function (service role only; the app server calls it after the person confirmed and after GitHub answered):
--   github_record_removed(actor, item, result, reason)
--     the actor must be a creator or admin of the item's workspace and not a service account; the write source must not be MCP (Claude);
--     the item must be IN THE TRASH; the link must be in mode 'push' (an issue that came from GitHub and is only followed is never touched);
--     handled once, a second call changes nothing; audited as the person, source UI.
-- Initiative Status and Build Status are never written by it (rule 6): only item_github_links changes. Functions replaced by this migration: none. No DROP statements.

alter table public.item_github_links
  add column removed_handled_at timestamptz,
  add column removed_result text check (removed_result is null or removed_result in ('closed', 'already_done', 'not_found')),
  add column removed_reason text check (removed_reason is null or removed_reason in ('not_planned')),
  add constraint item_github_links_removed_consistent check ((removed_handled_at is null) = (removed_result is null));

create function public.github_record_removed(p_actor uuid, p_item uuid, p_result text, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_deleted timestamptz;
  v_link public.item_github_links%rowtype;
begin
  select tenant_id, deleted_at into v_tenant, v_deleted from public.items where id = p_item;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  -- rules 3 and 10: only a person who is a creator or admin; never a service account, never Claude (MCP), never platform staff (they are not members)
  if public.write_source() = 'MCP'
     or not exists (select 1 from public.tenant_members m
                    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account) then
    raise exception 'Only a creator or admin can close the GitHub issue of a removed initiative.' using errcode = '42501';
  end if;
  if v_deleted is null then raise exception 'The initiative is not in the Trash.' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('closed', 'already_done', 'not_found') then raise exception 'bad result' using errcode = '22023'; end if;
  select * into v_link from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item for update;
  if not found then raise exception 'This initiative has no GitHub link.' using errcode = 'P0002'; end if;
  if v_link.mode <> 'push' then
    raise exception 'The GitHub issue is only followed: Product Velocity never closes it.' using errcode = '42501';
  end if;
  if v_link.removed_handled_at is not null then return; end if; -- handled once; a second call changes nothing
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_github_links
     set removed_handled_at = now(), removed_result = p_result,
         removed_reason = case when p_result = 'closed' then 'not_planned' else null end
   where id = v_link.id;
end $$;
revoke all on function public.github_record_removed(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.github_record_removed(uuid, uuid, text, text) to service_role;
