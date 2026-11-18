-- Issue #513 (decision 2026-11-18-jira-initiative-fields.md, the GitHub twin): Health, Initiative Status and Initiative Phase on single-select fields of the
-- GitHub Project board. The mapping lives in projects.github_board (jsonb, no change). This migration adds two things:
-- 1. sync_base_valid() also accepts the keys health and initiative_status (hashes only, as for the other board values). Initiative Phase has no key: it
--    never comes back from the board, so there is nothing to compare.
-- 2. github_apply_select_pull(actor, item, fields, base): a person chose Keep GitHub for a Health or Initiative Status that was changed on the board. It
--    takes health and initiative_status ONLY (never initiative_phase, never Build Status, never a commercial field), audited as the person. The values are
--    checked by the check constraints of items. Same permission rules as github_apply_pull (a creator or admin as a person; never a service account).
-- Functions replaced by this migration: sync_base_valid (a create or replace that keeps every key it had). No DROP statements. No table change.

create or replace function public.sync_base_valid(b jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select b is null or (
    jsonb_typeof(b) = 'object'
    and not exists (select 1 from jsonb_each_text(b) e where e.key not in ('title', 'summary', 'description', 'hypothesis', 'priority', 'group', 'due', 'size', 'assignees', 'health', 'initiative_status') or e.value !~ '^[0-9a-f]{64}$')
  )
$$;

create function public.github_apply_select_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  k text;
  v_old public.items%rowtype;
  v_changed jsonb := '{}'::jsonb;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can take over a value from GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push' and l.issue_number is not null) then
    raise exception 'This item has no GitHub issue that can be synced.' using errcode = 'P0002';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'bad fields' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('health', 'initiative_status') then
      raise exception 'The field % cannot be taken over from GitHub.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  select * into v_old from public.items where id = p_item for update;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set
    health = case when p_fields ? 'health' then p_fields ->> 'health' else health end,
    initiative_status = case when p_fields ? 'initiative_status' then p_fields ->> 'initiative_status' else initiative_status end
  where id = p_item;
  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k when 'health' then v_old.health else v_old.initiative_status end);
  end loop;
  if p_base is not null then perform public.github_record_base(p_actor, p_item, p_base); end if;
  return v_changed; -- the values that were replaced, for the undo step
end $$;
revoke all on function public.github_apply_select_pull(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.github_apply_select_pull(uuid, uuid, jsonb, jsonb) to service_role;
