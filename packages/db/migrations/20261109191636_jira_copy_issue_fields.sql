-- Issue #365 (parity with #364). Pulling in a Jira issue keeps its text and its type:/area: labels once, like a GitHub issue.
-- jira_copy_issue_description(actor, item, text) and jira_copy_issue_labels(actor, item, change_type, focus_area): service role only, the twins of
-- github_copy_issue_description / github_copy_issue_labels. Same guards: the actor is a creator or admin who is a person; the initiative was made by
-- the pull-in (source 'Jira issue KEY') and has a Jira link of either mode; a value is stored ONLY while that field is still empty, so nothing a
-- person wrote is ever replaced; Description is cut at 20,000 characters, Focus Area at 120, Change Type must be one of the three values the
-- column allows. Audited as the person. New functions only: nothing is replaced.
create function public.jira_copy_issue_description(p_actor uuid, p_item uuid, p_text text) returns boolean
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
    raise exception 'Only a creator or admin can copy the text of a Jira issue.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.items i join public.item_jira_links l on l.item_id = i.id and l.tenant_id = i.tenant_id
    where i.id = p_item and i.source like 'Jira issue %'
  ) then
    raise exception 'This initiative was not pulled in from a Jira issue.' using errcode = 'P0002';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 then return false; end if;
  if char_length(btrim(coalesce(v_current, ''))) > 0 then return false; end if; -- never replace what a person wrote
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who pulled it in
  update public.items set description = left(p_text, 20000) where id = p_item;
  return true;
end $$;
revoke all on function public.jira_copy_issue_description(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.jira_copy_issue_description(uuid, uuid, text) to service_role;

create function public.jira_copy_issue_labels(p_actor uuid, p_item uuid, p_change_type text, p_focus_area text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_change text;
  v_focus text;
  v_out jsonb := '{}'::jsonb;
  v_area text := nullif(btrim(left(coalesce(p_focus_area, ''), 120)), '');
begin
  select tenant_id, change_type, focus_area into v_tenant, v_change, v_focus from public.items where id = p_item and deleted_at is null for update;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can copy the labels of a Jira issue.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.items i join public.item_jira_links l on l.item_id = i.id and l.tenant_id = i.tenant_id
    where i.id = p_item and i.source like 'Jira issue %'
  ) then
    raise exception 'This initiative was not pulled in from a Jira issue.' using errcode = 'P0002';
  end if;
  if p_change_type is not null and p_change_type not in ('New feature', 'Improvement to existing feature', 'Bug') then
    raise exception 'Jira cannot set Change Type to %.', p_change_type using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if p_change_type is not null and v_change is null then
    update public.items set change_type = p_change_type where id = p_item;
    v_out := v_out || jsonb_build_object('change_type', true);
  end if;
  if v_area is not null and nullif(btrim(coalesce(v_focus, '')), '') is null then
    update public.items set focus_area = v_area where id = p_item;
    v_out := v_out || jsonb_build_object('focus_area', true);
  end if;
  return v_out;
end $$;
revoke all on function public.jira_copy_issue_labels(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.jira_copy_issue_labels(uuid, uuid, text, text) to service_role;
