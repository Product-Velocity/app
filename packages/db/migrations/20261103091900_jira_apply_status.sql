-- Jira, refresh of linked initiatives (issue #67, #71): the READ side of the sync. A Jira issue pulled in as an initiative got its Build Status once,
-- at pull-in. This function applies a later read of the issue to its linked initiative, the Jira twin of github_apply_issue (docs/04, 21).
-- jira_apply_statuses(connection, site, rows): service role only (the app server and the daily check call it after reading Jira).
--   rows = [{key, status, category, updated}], at most 500, all of ONE connection and site. For each row that has an item_jira_links row:
--   * compare before write: an answer that says nothing new writes nothing; an answer OLDER than jira_updated_at is ignored (stale);
--   * item_jira_links gets jira_status, jira_status_category, jira_updated_at;
--   * Build Status (items.status) follows the status CATEGORY: new = Not started, indeterminate = In progress, done = Done, with status_changed_at
--     and last_synced_at. Build Status is tracker-driven and read only for people (rule 6). Initiative Status is never touched (a closed ticket
--     means the build is complete, not the initiative).
--   * works for both link modes (follow and push): ownership decides what Product Velocity may SEND later, never who owns delivery status;
--   * a deleted (trashed) initiative keeps its link up to date but its status is not changed;
--   * source of every write is 'system' (app.via), so the audit log shows actor (none), source, old and new value for both tables.
--   Returns [{key, item_id, stale, changes}] for the rows that have a link, where changes = {"status": [old, new], "jira_status": [old, new]}.
-- Functions replaced by this migration: none. No DROP statements. No table changes (item_jira_links already has the columns).

create function public.jira_apply_statuses(p_connection uuid, p_site text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  l public.item_jira_links%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_changes jsonb;
  v_old text;
  v_new text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'Up to 500 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);
  for r in
    select * from jsonb_to_recordset(p_rows) as x(key text, status text, category text, updated timestamptz)
  loop
    if r.key is null or r.key !~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$' then continue; end if;
    if r.category is not null and r.category not in ('new', 'indeterminate', 'done') then continue; end if;
    select * into l from public.item_jira_links x
     where x.connection_id = p_connection and x.site_id = p_site and x.issue_key = r.key
     for update;
    if not found then continue; end if;

    if l.jira_updated_at is not null and r.updated is not null and r.updated < l.jira_updated_at then
      v_out := v_out || jsonb_build_object('key', r.key, 'item_id', l.item_id, 'stale', true, 'changes', '{}'::jsonb);
      continue; -- older than what we already know
    end if;

    v_changes := '{}'::jsonb;
    -- a read without a category (a status Jira did not classify) keeps the category and the Build Status we have
    if r.category is not null
       and (l.jira_status, l.jira_status_category, l.jira_updated_at)
           is distinct from (coalesce(r.status, l.jira_status), r.category, coalesce(r.updated, l.jira_updated_at)) then
      update public.item_jira_links x set
        jira_status = coalesce(r.status, x.jira_status), jira_status_category = r.category, jira_updated_at = coalesce(r.updated, x.jira_updated_at)
       where x.id = l.id;
      if l.jira_status is distinct from coalesce(r.status, l.jira_status) then
        v_changes := v_changes || jsonb_build_object('jira_status', jsonb_build_array(l.jira_status, coalesce(r.status, l.jira_status)));
      end if;
    end if;

    if r.category is not null then
      v_new := case r.category when 'new' then 'Not started' when 'indeterminate' then 'In progress' else 'Done' end;
      select i.status into v_old from public.items i where i.id = l.item_id and i.deleted_at is null;
      if found and v_new is distinct from v_old then
        update public.items set status = v_new, status_changed_at = now(), last_synced_at = now() where id = l.item_id;
        v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(v_old, v_new));
      end if;
    end if;
    v_out := v_out || jsonb_build_object('key', r.key, 'item_id', l.item_id, 'stale', false, 'changes', v_changes);
  end loop;
  return v_out;
end $$;
revoke all on function public.jira_apply_statuses(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.jira_apply_statuses(uuid, text, jsonb) to service_role;
