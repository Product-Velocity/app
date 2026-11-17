-- Jira Initiative level (issue #431, docs/decisions/2026-11-13-tracker-initiative-level.md): an initiative can be linked to an issue ABOVE Epic
-- (a Jira Initiative, hierarchy level 2). Its own status then says little about the build: the epics under it do. So:
-- item_jira_links.issue_level: the hierarchy level of the linked issue as Jira last reported it (-1 sub-task, 0 story, 1 epic, 2 and up above Epic).
--   Null until the tree has been read once. Written only by jira_apply_link_level (service role); it decides which Build Status and which dates to use.
-- jira_apply_link_level(connection, site, item, level, category): service role only. Stores the level (compare before write) and, for a linked
--   issue above Epic only, applies the Build Status derived from the epics (category new -> Not started, indeterminate -> In progress, done -> Done),
--   compare before write, source 'system', old and new value audited like jira_apply_statuses. Initiative Status is never touched (rule 6): a done
--   epic means the build is progressing or complete, never that the initiative is. For an issue at Epic level or below the category is ignored here
--   (jira_apply_statuses keeps driving Build Status from the issue itself). Returns what changed: {issue_level: [old, new], status: [old, new]}.
-- Functions replaced by this migration: none. No DROP statements.

alter table public.item_jira_links add column issue_level smallint check (issue_level is null or issue_level between -1 and 20);

create function public.jira_apply_link_level(p_connection uuid, p_site text, p_item uuid, p_level smallint, p_category text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_jira_links%rowtype;
  v_old text;
  v_new text;
  v_changes jsonb := '{}'::jsonb;
begin
  if p_level is null or p_level < -1 or p_level > 20 then raise exception 'Not a Jira hierarchy level.' using errcode = '22023'; end if;
  if p_category is not null and p_category not in ('new', 'indeterminate', 'done') then raise exception 'Not a status category.' using errcode = '22023'; end if;
  select * into l from public.item_jira_links x where x.item_id = p_item and x.connection_id = p_connection and x.site_id = p_site for update;
  if not found then raise exception 'That initiative is not linked to this Jira connection.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);

  if l.issue_level is distinct from p_level then
    update public.item_jira_links x set issue_level = p_level where x.id = l.id;
    v_changes := v_changes || jsonb_build_object('issue_level', jsonb_build_array(l.issue_level, p_level));
  end if;

  if p_level >= 2 and p_category is not null then
    v_new := case p_category when 'new' then 'Not started' when 'indeterminate' then 'In progress' else 'Done' end;
    select i.status into v_old from public.items i where i.id = p_item and i.deleted_at is null;
    if found and v_new is distinct from v_old then
      update public.items set status = v_new, status_changed_at = now(), last_synced_at = now() where id = p_item;
      v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(v_old, v_new));
    end if;
  end if;
  return v_changes;
end $$;
revoke all on function public.jira_apply_link_level(uuid, text, uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.jira_apply_link_level(uuid, text, uuid, smallint, text) to service_role;
