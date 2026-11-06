-- Ready for build at Gate B (issue #358; decision 2026-11-06-ready-at-gate-b): after a confirmed Sync, the tracker shows what is ready for engineers
-- (GitHub Project board Status "Ready", Jira status "To do"). The tracker calls are made by the app after the person confirmed; this migration only REMEMBERS
-- that it was handled once, so reading the board or Jira status back never makes the app write again (a person who moves the item back is not overruled):
--   item_github_links.ready_handled_at / ready_result / ready_status, and the same three on item_jira_links.
--   ready_result: set (the tracker status was written) | already_ahead (the item was past its start already: nothing was written).
-- Functions (service role only): github_record_ready(actor, item, result, status), jira_record_ready(actor, item, result, status).
--   the actor must be a creator or admin of the workspace and not a service account; the write source must not be MCP (Claude);
--   the item must be Ready for build (ready_for_build_at set, phase Build, not in the Trash); the link must be in mode 'push' (a followed issue is never touched);
--   handled once, a second call changes nothing; audited as the person, source UI by the links' audit triggers.
-- Initiative Status, Build Status, gates and phases are never written by it (rule 6, PV004/PV006 untouched). Functions replaced: none. No DROP statements.

alter table public.item_github_links
  add column ready_handled_at timestamptz,
  add column ready_result text check (ready_result is null or ready_result in ('set', 'already_ahead')),
  add column ready_status text check (ready_status is null or char_length(ready_status) <= 100),
  add constraint item_github_links_ready_consistent check ((ready_handled_at is null) = (ready_result is null));

alter table public.item_jira_links
  add column ready_handled_at timestamptz,
  add column ready_result text check (ready_result is null or ready_result in ('set', 'already_ahead')),
  add column ready_status text check (ready_status is null or char_length(ready_status) <= 100),
  add constraint item_jira_links_ready_consistent check ((ready_handled_at is null) = (ready_result is null));

create function public.github_record_ready(p_actor uuid, p_item uuid, p_result text, p_status text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_deleted timestamptz;
  v_ready timestamptz;
  v_phase text;
  v_link public.item_github_links%rowtype;
begin
  select tenant_id, deleted_at, ready_for_build_at, initiative_phase into v_tenant, v_deleted, v_ready, v_phase from public.items where id = p_item;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if public.write_source() = 'MCP'
     or not exists (select 1 from public.tenant_members m
                    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account) then
    raise exception 'Only a creator or admin can set the board status of a ready initiative.' using errcode = '42501';
  end if;
  if v_deleted is not null or v_ready is null or v_phase is distinct from 'Build' then raise exception 'The initiative is not ready for build.' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('set', 'already_ahead') then raise exception 'bad result' using errcode = '22023'; end if;
  select * into v_link from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item for update;
  if not found then raise exception 'This initiative has no GitHub link.' using errcode = 'P0002'; end if;
  if v_link.mode <> 'push' then raise exception 'The GitHub issue is only followed: Product Velocity never changes its board status.' using errcode = '42501'; end if;
  if v_link.ready_handled_at is not null then return; end if;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_github_links
     set ready_handled_at = now(), ready_result = p_result, ready_status = left(nullif(btrim(p_status), ''), 100)
   where id = v_link.id;
end $$;
revoke all on function public.github_record_ready(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.github_record_ready(uuid, uuid, text, text) to service_role;

create function public.jira_record_ready(p_actor uuid, p_item uuid, p_result text, p_status text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_deleted timestamptz;
  v_ready timestamptz;
  v_phase text;
  v_link public.item_jira_links%rowtype;
begin
  select tenant_id, deleted_at, ready_for_build_at, initiative_phase into v_tenant, v_deleted, v_ready, v_phase from public.items where id = p_item;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if public.write_source() = 'MCP' or not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can move the Jira issue of a ready initiative.' using errcode = '42501';
  end if;
  if v_deleted is not null or v_ready is null or v_phase is distinct from 'Build' then raise exception 'The initiative is not ready for build.' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('set', 'already_ahead') then raise exception 'bad result' using errcode = '22023'; end if;
  select * into v_link from public.item_jira_links l where l.tenant_id = v_tenant and l.item_id = p_item for update;
  if not found then raise exception 'This initiative has no Jira link.' using errcode = 'P0002'; end if;
  if v_link.mode <> 'push' then raise exception 'The Jira issue came from Jira: Product Velocity never changes its status.' using errcode = '42501'; end if;
  if v_link.ready_handled_at is not null then return; end if;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_jira_links
     set ready_handled_at = now(), ready_result = p_result, ready_status = left(nullif(btrim(p_status), ''), 100)
   where id = v_link.id;
end $$;
revoke all on function public.jira_record_ready(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.jira_record_ready(uuid, uuid, text, text) to service_role;
