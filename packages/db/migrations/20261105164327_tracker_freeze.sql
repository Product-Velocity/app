-- 20261105164327_tracker_freeze: <what this changes and why; the request or issue number>
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- New tables: RLS with the fast policy pattern, an index starting with tenant_id, and a probe in packages/db/tests/rls.test.ts.
-- If you replace a whole function (create or replace), say which, and check no open branch changes it too (docs/23-PARALLEL-WORK.md).

-- Stop syncing finished initiatives (issue #323, docs/28-DECISION-GATES.md section 9; docs/decisions/2026-11-05-lifecycle-and-gates.md item 9).
-- 14 days after Initiative Status becomes Completed or Cancelled, a tracker link is Frozen (frozen_at): the daily check, "Check now", the Sync dialog
-- and the Jira refresh skip it and webhooks for it are not stored. An Admin or Approver can resume it; the status moving back unfreezes it.
-- Freezing and resuming are audited by the existing audit triggers of both link tables (actor, source, old and new value).
-- New columns, functions and one trigger only: no existing function is replaced.

alter table public.item_github_links add column frozen_at timestamptz, add column sync_resumed_at timestamptz;
alter table public.item_jira_links add column frozen_at timestamptz, add column sync_resumed_at timestamptz;
create index item_github_links_frozen_idx on public.item_github_links (tenant_id, frozen_at) where frozen_at is not null;
create index item_jira_links_frozen_idx on public.item_jira_links (tenant_id, frozen_at) where frozen_at is not null;

-- The daily job (service role only): freezes the links of initiatives that finished more than p_days days ago and have not been resumed since.
-- "Finished" is the latest time Initiative Status was set to Completed or Cancelled, from the audit log (the row's own time when there is none).
create function public.freeze_finished_links(p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_gh int;
  v_jira int;
  v_cut timestamptz := now() - make_interval(days => greatest(p_days, 0));
begin
  with finished as (
    select i.id as item_id,
           coalesce((select max(a.at) from public.audit_log a
                      where a.entity = 'items' and a.entity_id = i.id and a.field = 'initiative_status' and a.new in ('"Completed"'::jsonb, '"Cancelled"'::jsonb)),
                    i.updated_at) as since
      from public.items i
     where i.initiative_status in ('Completed', 'Cancelled') and i.deleted_at is null
  ), upd as (
    update public.item_github_links l set frozen_at = now()
      from finished f
     where l.item_id = f.item_id and l.frozen_at is null and f.since <= v_cut and (l.sync_resumed_at is null or l.sync_resumed_at <= v_cut)
    returning 1)
  select count(*) into v_gh from upd;
  with finished as (
    select i.id as item_id,
           coalesce((select max(a.at) from public.audit_log a
                      where a.entity = 'items' and a.entity_id = i.id and a.field = 'initiative_status' and a.new in ('"Completed"'::jsonb, '"Cancelled"'::jsonb)),
                    i.updated_at) as since
      from public.items i
     where i.initiative_status in ('Completed', 'Cancelled') and i.deleted_at is null
  ), upd as (
    update public.item_jira_links l set frozen_at = now()
      from finished f
     where l.item_id = f.item_id and l.frozen_at is null and f.since <= v_cut and (l.sync_resumed_at is null or l.sync_resumed_at <= v_cut)
    returning 1)
  select count(*) into v_jira from upd;
  return jsonb_build_object('github', v_gh, 'jira', v_jira);
end $$;

-- An Admin or a person with the Approver permission resumes syncing one initiative (never Claude, a service account or staff).
create function public.resume_sync(p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_gh int;
  v_jira int;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  if public.write_source() = 'MCP' or not exists (
       select 1 from public.tenant_members m
        where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.status = 'active' and not m.is_service_account
          and (m.role = 'admin' or m.is_approver)) then
    raise exception 'Only an Admin or an Approver can resume syncing' using errcode = '42501';
  end if;
  with u as (update public.item_github_links set frozen_at = null, sync_resumed_at = now() where item_id = p_item and frozen_at is not null returning 1)
    select count(*) into v_gh from u;
  with u as (update public.item_jira_links set frozen_at = null, sync_resumed_at = now() where item_id = p_item and frozen_at is not null returning 1)
    select count(*) into v_jira from u;
  return jsonb_build_object('github', v_gh, 'jira', v_jira);
end $$;

-- Moving the status back to Active or On hold unfreezes the links by itself (the grace period starts again from the next Completed or Cancelled).
create function public.items_unfreeze() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.initiative_status is distinct from old.initiative_status and coalesce(new.initiative_status, '') not in ('Completed', 'Cancelled') then
    update public.item_github_links set frozen_at = null where item_id = new.id and frozen_at is not null;
    update public.item_jira_links set frozen_at = null where item_id = new.id and frozen_at is not null;
  end if;
  return null;
end $$;
create trigger items_z_unfreeze after update of initiative_status on public.items
  for each row execute function public.items_unfreeze();

revoke all on function public.freeze_finished_links(integer), public.resume_sync(uuid), public.items_unfreeze() from public, anon, authenticated;
grant execute on function public.resume_sync(uuid) to authenticated;
grant execute on function public.freeze_finished_links(integer) to service_role;
