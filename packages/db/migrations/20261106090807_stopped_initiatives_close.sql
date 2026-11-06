-- 20261106090807_stopped_initiatives_close: <what this changes and why; the request or issue number>
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- New tables: RLS with the fast policy pattern, an index starting with tenant_id, and a probe in packages/db/tests/rls.test.ts.
-- If you replace a whole function (create or replace), say which, and check no open branch changes it too (docs/23-PARALLEL-WORK.md).

-- A stopped initiative may have its tracker issue closed like a removed one (issue #343; Ashu 2026-11-05: "a Stop at a gate offers to close the tracker issue, same confirm flow").
-- "Stopped" = Initiative Status Cancelled, not deleted, and the latest decided gate request of the initiative is a Stop. Everything else stays as in the two
-- close-removed decisions (2026-11-03-github-close-removed, 2026-11-03-jira-close-removed): link in mode push, handled once, a creator or admin as a person,
-- never Claude, never a service account.
-- Replaces the whole functions public.github_record_removed and public.jira_record_removed (last defined in 20261103225826_github_close_removed and
-- 20261104090419_jira_record_removed_refuse_mcp, which keeps the refusal of a write whose source is MCP; no open branch changes them). The only change is the "in the Trash" check.

create function public.item_is_stopped(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i
     where i.id = p_item and i.deleted_at is null and i.initiative_status = 'Cancelled'
       and (select g.outcome from public.gate_reviews g
             where g.item_id = i.id and g.kind = 'decision' and g.decided_at is not null
             order by g.decided_at desc, g.id desc limit 1) = 'stop')
$$;
revoke all on function public.item_is_stopped(uuid) from public, anon, authenticated;
grant execute on function public.item_is_stopped(uuid) to service_role;

create or replace function public.github_record_removed(p_actor uuid, p_item uuid, p_result text, p_reason text default null)
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
    raise exception 'Only a creator or admin can close the GitHub issue of a removed or stopped initiative.' using errcode = '42501';
  end if;
  if v_deleted is null and not public.item_is_stopped(p_item) then raise exception 'The initiative is not in the Trash and was not stopped at a gate.' using errcode = '22023'; end if;
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
    raise exception 'Only a creator or admin can close the Jira issue of a removed or stopped initiative.' using errcode = '42501';
  end if;
  if v_deleted is null and not public.item_is_stopped(p_item) then raise exception 'The initiative is not in the Trash and was not stopped at a gate.' using errcode = '22023'; end if;
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
revoke all on function public.github_record_removed(uuid, uuid, text, text), public.jira_record_removed(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.github_record_removed(uuid, uuid, text, text), public.jira_record_removed(uuid, uuid, text, text, text) to service_role;
