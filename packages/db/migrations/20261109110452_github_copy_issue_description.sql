-- Issue #364 follow-up. Pull-in made initiatives from the light record (title only), so a pulled-in initiative's Description was empty.
-- Ashu decided (2026-11-09): read the issue's text once when a person pulls it in and keep it as the initiative's Description.
-- github_copy_issue_description(actor, item, text): service role only. Fills Description of an initiative made by the pull-in
-- (source 'GitHub issue #N', with a GitHub link of either mode) and ONLY while the Description is still empty, so it can never replace
-- something a person wrote. The actor must be a creator or admin who is a person. The audit log records that person (source UI, as set by the caller).
-- Returns true when the text was stored. New function only: nothing is replaced.
create function public.github_copy_issue_description(p_actor uuid, p_item uuid, p_text text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_current text;
begin
  select tenant_id, description into v_tenant, v_current from public.items where id = p_item and deleted_at is null for update;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can copy the text of a GitHub issue.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.items i join public.item_github_links l on l.item_id = i.id and l.tenant_id = i.tenant_id
    where i.id = p_item and i.source like 'GitHub issue #%'
  ) then
    raise exception 'This initiative was not pulled in from a GitHub issue.' using errcode = 'P0002';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 then return false; end if;
  if char_length(btrim(coalesce(v_current, ''))) > 0 then return false; end if; -- never replace what a person wrote
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who pulled it in
  update public.items set description = left(p_text, 20000) where id = p_item;
  return true;
end $$;
revoke all on function public.github_copy_issue_description(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.github_copy_issue_description(uuid, uuid, text) to service_role;
