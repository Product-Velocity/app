-- Issue #364 follow-up. Ashu confirmed (2026-11-09): the GitHub labels `type:<x>` mean Change Type and `area:<x>` mean Focus Area.
-- When a person pulls an issue in, the app reads those two labels from the Incoming record and keeps them on the new initiative.
-- github_copy_issue_labels(actor, item, change_type, focus_area): service role only. Same guards as github_copy_issue_description:
-- a creator or admin who is a person, an initiative made by the pull-in (source 'GitHub issue #N') with a GitHub link of either mode.
-- Each value is stored ONLY while that field is still empty, so it never replaces what a person chose. change_type must be one of the three
-- values the column allows (New feature, Improvement to existing feature, Bug: see 20261109114500_change_type_bug) (the table's own check also holds); focus_area is cut at 120 characters. Returns which fields were stored.
-- Audited as the person. New function only: nothing is replaced.
create function public.github_copy_issue_labels(p_actor uuid, p_item uuid, p_change_type text, p_focus_area text) returns jsonb
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
    raise exception 'Only a creator or admin can copy the labels of a GitHub issue.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.items i join public.item_github_links l on l.item_id = i.id and l.tenant_id = i.tenant_id
    where i.id = p_item and i.source like 'GitHub issue #%'
  ) then
    raise exception 'This initiative was not pulled in from a GitHub issue.' using errcode = 'P0002';
  end if;
  if p_change_type is not null and p_change_type not in ('New feature', 'Improvement to existing feature', 'Bug') then
    raise exception 'GitHub cannot set Change Type to %.', p_change_type using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who pulled it in
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
revoke all on function public.github_copy_issue_labels(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.github_copy_issue_labels(uuid, uuid, text, text) to service_role;
