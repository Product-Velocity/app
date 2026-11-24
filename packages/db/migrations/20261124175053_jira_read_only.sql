-- Jira read-only mode per project (issue #656; GitHub twin #657; docs/decisions/2026-11-24-jira-read-only-mode.md).
-- A Product Velocity project linked to a Jira project can be set READ ONLY: nothing is ever written to Jira for it. The epics listed on an
-- initiative are then read by key (with their children) into the same read-only tree as a linked Jira Initiative, and roll up delivery counts and
-- Build Status. An admin can switch the project to "can write" later; switching sends nothing by itself (the next Sync with Jira previews and asks).
-- jira_project_links.read_only: default false (nothing changes for existing links). Changed only through jira_set_project_read_only() by a human
--   admin of the workspace (never Claude, never a service account, never platform staff); audited by the table's audit trigger.
-- Guards (triggers, so no existing function is replaced): while the project is read only, an initiative of it cannot get a Jira link in mode
--   'push' (Product Velocity owns it), and an epic request cannot be recorded as 'linked' (that state means "Sync set the parent in Jira").
--   Error PV013.
-- jira_apply_epic_tree(connection, site, item, nodes, total, closed, pct, category): service role only. The twin of jira_apply_tree for an initiative
--   that has NO Jira issue but epics listed on it (item_jira_epic_requests) in a read-only project: replaces the item's item_jira_tree rows
--   (level 1 = the listed epics, whose parent_key is their own key; level 2 = their children), marks the light records as children (so they are not
--   offered as new items), writes the roll-up counts and the Build Status derived from the epics (new = Not started, indeterminate = In progress,
--   done = Done), compare before write, source 'system', old and new value audited. Initiative Status is never touched (rule 6).
-- Functions replaced by this migration: none. No DROP statements.

alter table public.jira_project_links add column read_only boolean not null default false;

create function public.jira_set_project_read_only(p_project uuid, p_read_only boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_old boolean;
begin
  if p_read_only is null then raise exception 'Say whether the project is read only.' using errcode = '22023'; end if;
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change whether a project may write to Jira.' using errcode = '42501';
  end if;
  select read_only into v_old from public.jira_project_links where project_id = p_project and tenant_id = v_tenant;
  if not found then raise exception 'This project is not linked to a Jira project.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.jira_project_links set read_only = p_read_only where project_id = p_project and tenant_id = v_tenant and read_only is distinct from p_read_only;
  return v_old;
end $$;
revoke all on function public.jira_set_project_read_only(uuid, boolean) from public, anon;
grant execute on function public.jira_set_project_read_only(uuid, boolean) to authenticated;

create function public.jira_guard_read_only_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mode = 'push' and exists (
    select 1 from public.items i join public.jira_project_links pl on pl.tenant_id = i.tenant_id and pl.project_id = i.home_project_id
     where i.id = new.item_id and pl.read_only
  ) then
    raise exception 'This project is read only for Jira: Product Velocity cannot own a Jira issue here. An admin can switch the project to "can write" under Settings, Integrations, Jira.' using errcode = 'PV013';
  end if;
  return new;
end $$;
create trigger item_jira_links_read_only_guard before insert or update of mode on public.item_jira_links
  for each row execute function public.jira_guard_read_only_link();

create function public.jira_guard_read_only_epic() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'linked' and exists (
    select 1 from public.items i join public.jira_project_links pl on pl.tenant_id = i.tenant_id and pl.project_id = i.home_project_id
     where i.id = new.item_id and pl.read_only
  ) then
    raise exception 'This project is read only for Jira: an epic cannot be moved under an initiative in Jira.' using errcode = 'PV013';
  end if;
  return new;
end $$;
create trigger item_jira_epic_requests_read_only_guard before insert or update of state on public.item_jira_epic_requests
  for each row execute function public.jira_guard_read_only_epic();

-- p_nodes: [{key, id, parent, level, position, title, type, status, category, assignee, url, updated}], at most 500; p_category: new | indeterminate | done | null
create function public.jira_apply_epic_tree(p_connection uuid, p_site text, p_item uuid, p_nodes jsonb, p_total integer, p_closed integer, p_pct integer, p_category text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.items%rowtype;
  v_tenant uuid;
  v_keys text[];
  v_nodes jsonb;
  v_deleted integer;
  v_upserted integer;
  v_rolled boolean := false;
  v_new text;
  v_changes jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) > 500 then raise exception 'Up to 500 issues per initiative.' using errcode = '22023'; end if;
  if p_total is null or p_total < 0 or p_closed is null or p_closed < 0 or p_closed > p_total or (p_pct is not null and (p_pct < 0 or p_pct > 100)) then
    raise exception 'The counts do not add up.' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in ('new', 'indeterminate', 'done') then raise exception 'Not a status category.' using errcode = '22023'; end if;
  select x.tenant_id into v_tenant from public.items x where x.id = p_item and x.deleted_at is null;
  if v_tenant is null then raise exception 'That initiative was not found.' using errcode = 'P0002'; end if;
  -- only for an initiative of a read-only project that is linked to this connection and site and has epics listed on it
  if not exists (
    select 1 from public.items x join public.jira_project_links pl on pl.tenant_id = x.tenant_id and pl.project_id = x.home_project_id
     where x.id = p_item and pl.read_only and pl.connection_id = p_connection and pl.site_id = p_site
  ) or not exists (select 1 from public.item_jira_epic_requests r where r.item_id = p_item and r.tenant_id = v_tenant and r.state in ('pending', 'linked')) then
    raise exception 'That initiative has no epics listed in a read-only Jira project of this connection.' using errcode = '22023';
  end if;
  perform set_config('app.via', 'system', true);

  select coalesce(jsonb_agg(jsonb_build_object('key', n.key, 'id', n.id, 'parent', n.parent, 'level', n.level, 'position', coalesce(n.position, 0), 'title', left(n.title, 300),
                  'type', left(n.type, 80), 'status', left(n.status, 100), 'category', n.category, 'assignee', left(n.assignee, 100), 'url', n.url, 'updated', n.updated)), '[]'::jsonb)
    into v_nodes
    from jsonb_to_recordset(p_nodes) as n(key text, id text, parent text, level smallint, position integer, title text, type text, status text, category text, assignee text, url text, updated timestamptz)
   where n.key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$' and n.parent ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'
     and n.level in (1, 2) and n.title is not null
     and (n.category is null or n.category in ('new', 'indeterminate', 'done'))
     and (n.id is null or n.id ~ '^[0-9]{1,20}$') and (n.url is null or n.url ~ '^https://');
  select coalesce(array_agg(x.key), '{}') into v_keys from jsonb_to_recordset(v_nodes) as x(key text);

  delete from public.item_jira_tree t where t.item_id = p_item and t.issue_key <> all (v_keys);
  get diagnostics v_deleted = row_count;
  insert into public.item_jira_tree as t (tenant_id, item_id, issue_key, issue_id, parent_key, level, position, title, issue_type, status, status_category, assignee, html_url, jira_updated_at)
  select v_tenant, p_item, n.key, n.id, n.parent, n.level, n.position, n.title, n.type, n.status, n.category, n.assignee, n.url, n.updated
    from jsonb_to_recordset(v_nodes) as n(key text, id text, parent text, level smallint, position integer, title text, type text, status text, category text, assignee text, url text, updated timestamptz)
  on conflict (item_id, issue_key) do update set
    issue_id = excluded.issue_id, parent_key = excluded.parent_key, level = excluded.level, position = excluded.position, title = excluded.title,
    issue_type = excluded.issue_type, status = excluded.status, status_category = excluded.status_category, assignee = excluded.assignee,
    html_url = excluded.html_url, jira_updated_at = excluded.jira_updated_at, updated_at = now()
  where (t.issue_id, t.parent_key, t.level, t.position, t.title, t.issue_type, t.status, t.status_category, t.assignee, t.html_url, t.jira_updated_at)
        is distinct from (excluded.issue_id, excluded.parent_key, excluded.level, excluded.position, excluded.title, excluded.issue_type, excluded.status, excluded.status_category, excluded.assignee, excluded.html_url, excluded.jira_updated_at);
  get diagnostics v_upserted = row_count;

  update public.jira_issues j set child_of_item = null where j.child_of_item = p_item and j.issue_key <> all (v_keys);
  update public.jira_issues j set child_of_item = p_item
   where j.connection_id = p_connection and j.site_id = p_site and j.issue_key = any (v_keys) and j.pull_state <> 'pulled' and j.child_of_item is distinct from p_item;

  select * into i from public.items x where x.id = p_item and x.deleted_at is null for update;
  if found and not (p_total = 0 and i.issues_total is null and i.issues_closed is null and i.delivery_progress_pct is null)
     and (i.issues_total, i.issues_closed, i.delivery_progress_pct) is distinct from (p_total, p_closed, p_pct) then
    update public.items set issues_total = p_total, issues_closed = p_closed, delivery_progress_pct = p_pct, last_synced_at = now() where id = p_item;
    v_rolled := true;
  end if;
  if found and p_category is not null then
    v_new := case p_category when 'new' then 'Not started' when 'indeterminate' then 'In progress' else 'Done' end;
    if v_new is distinct from i.status then
      update public.items set status = v_new, status_changed_at = now(), last_synced_at = now() where id = p_item;
      v_changes := jsonb_build_object('status', jsonb_build_array(i.status, v_new));
    end if;
  end if;
  return jsonb_build_object('nodes', jsonb_array_length(p_nodes), 'removed', v_deleted, 'written', v_upserted, 'rolled_up', v_rolled, 'changes', v_changes);
end $$;
revoke all on function public.jira_apply_epic_tree(uuid, text, uuid, jsonb, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.jira_apply_epic_tree(uuid, text, uuid, jsonb, integer, integer, integer, text) to service_role;
