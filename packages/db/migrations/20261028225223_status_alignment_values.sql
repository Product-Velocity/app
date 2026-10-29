-- Status alignment, step 2 (issue #247, decision docs/decisions/2026-10-28-status-alignment.md).
-- Three fields change their values; no table or function is added, one function is replaced (github_apply_issue).
--   Initiative Status (people):   Active | On hold | Cancelled. Backlog / Not Started move to Planning Status;
--                                 In Progress -> Active, Paused -> On hold, Completed -> carried by Initiative Phase.
--   Planning Status (people):     Backlog | Not started | Candidate | Included | Committed | Deferred | Dropped.
--   Build Status (tracker, read-only): Not started | In progress | Done | Cancelled.
-- Every rewrite below is an ordinary update, so it is audited like any other change (rule 5).

-- 1. Build Status: remap, then fence the column so a tracker can only write the four values.
update public.items set status = case status
    when 'Backlog' then 'Not started'
    when 'Not Started' then 'Not started'
    when 'In Progress' then 'In progress'
    when 'Paused' then 'In progress'
    when 'Completed' then 'Done'
    else status end
 where status in ('Backlog', 'Not Started', 'In Progress', 'Paused', 'Completed');
alter table public.items add constraint items_build_status_check
  check (status is null or status in ('Not started', 'In progress', 'Done', 'Cancelled'));

-- 1b. Planning Status ships now (it was a phase 5 field): a column people edit, like Initiative Status.
alter table public.items add column planning_status text
  check (planning_status in ('Backlog', 'Not started', 'Candidate', 'Included', 'Committed', 'Deferred', 'Dropped'));
grant insert (planning_status) on public.items to authenticated;
grant update (planning_status) on public.items to authenticated;

alter table public.items drop constraint items_initiative_status_check; -- 0023 gave the column an unnamed check; Postgres named it this
-- 2. Initiative Status: what only a person knows. Backlog and Not Started become a Planning Status when that is still empty;
--    Completed becomes Initiative Phase Completed when no phase was set (a set phase is left alone).
update public.items set planning_status = case initiative_status when 'Backlog' then 'Backlog' else 'Not started' end
 where initiative_status in ('Backlog', 'Not Started') and planning_status is null;
update public.items set initiative_phase = 'Completed' where initiative_status = 'Completed' and initiative_phase is null;
update public.items set initiative_status = case initiative_status
    when 'In Progress' then 'Active'
    when 'Paused' then 'On hold'
    when 'Cancelled' then 'Cancelled'
    else null end
 where initiative_status is not null and initiative_status not in ('Active', 'On hold');
alter table public.items add constraint items_initiative_status_check
  check (initiative_status is null or initiative_status in ('Active', 'On hold', 'Cancelled'));

-- 3. The GitHub inbound rule writes the new Build Status words. Same logic as 0027, other values:
--    closed as completed -> Done, closed as not planned -> Cancelled, reopened -> Not started, first look at an open issue -> Not started.
-- Replaces public.github_apply_issue as it stood in 0027; only the three words change. No open branch replaces it (checked 2026-10-28).
create or replace function public.github_apply_issue(
  p_connection uuid, p_repo text, p_number integer, p_issue_id bigint, p_node_id text,
  p_state text, p_state_reason text, p_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_github_links%rowtype;
  v_gh text;
  v_old text;
  v_new text;
  v_sync text;
  v_changes jsonb := '{}'::jsonb;
begin
  if p_state not in ('open', 'closed') then raise exception 'bad issue state' using errcode = '22023'; end if;
  select * into l from public.item_github_links
   where connection_id = p_connection and lower(repo_full_name) = lower(p_repo) and issue_number = p_number
   for update;
  if not found then return null; end if;

  v_gh := case when p_state = 'open' then 'open' when p_state_reason = 'not_planned' then 'closed_not_planned' else 'closed_completed' end;
  if l.gh_last_activity is not null and p_updated_at < l.gh_last_activity then
    return jsonb_build_object('item_id', l.item_id, 'stale', true, 'changes', '{}'::jsonb); -- older than what we already know
  end if;

  v_sync := case when l.mode = 'follow' and coalesce(p_issue_id, l.issue_id) is not null then 'synced' else l.sync_state end;
  -- write the link only when GitHub said something new
  if (l.gh_state, l.gh_last_activity, l.issue_id, l.issue_node_id, l.sync_state, l.last_error)
     is distinct from (v_gh, p_updated_at, coalesce(p_issue_id, l.issue_id), coalesce(p_node_id, l.issue_node_id), v_sync, case when l.mode = 'follow' then null else l.last_error end) then
    update public.item_github_links set
      gh_state = v_gh, gh_last_activity = p_updated_at, gh_synced_at = now(),
      issue_id = coalesce(p_issue_id, issue_id), issue_node_id = coalesce(p_node_id, issue_node_id),
      sync_state = v_sync,
      last_error = case when l.mode = 'follow' then null else l.last_error end
     where id = l.id;
  end if;
  if l.gh_state is distinct from v_gh then v_changes := v_changes || jsonb_build_object('gh_state', jsonb_build_array(l.gh_state, v_gh)); end if;

  select status into v_old from public.items where id = l.item_id;
  v_new := case v_gh
    when 'closed_completed' then 'Done'
    when 'closed_not_planned' then 'Cancelled'
    else case when l.gh_state in ('closed_completed', 'closed_not_planned') and v_old in ('Done', 'Cancelled') then 'Not started' else null end
  end;
  if v_new is null and v_gh = 'open' and v_old is null then v_new := 'Not started'; end if;
  if v_new is not null and v_new is distinct from v_old then
    update public.items set status = v_new, status_changed_at = now(), last_synced_at = now() where id = l.item_id;
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(v_old, v_new));
  end if;
  return jsonb_build_object('item_id', l.item_id, 'stale', false, 'changes', v_changes);
end $$;
