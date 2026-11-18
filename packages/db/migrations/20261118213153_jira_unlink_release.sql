-- Unlinking a Jira project that still has Jira-linked initiatives (Ashu, 2026-11-18: "an unlink button that asks for confirmation", keep or delete the
-- initiatives, clear Build Status, and let the marker label re-adopt them).
--
-- jira_unlink_project_release(project, delete): a human workspace admin only (never Claude, a service account or platform staff). In ONE transaction:
--   1. every initiative of the project loses its Jira link, its issue tree and its epic requests (Jira itself is not touched);
--   2. the live ones lose the Build Status the tracker gave them (status, status_changed_at, issues_total, issues_closed, delivery_progress_pct become
--      empty: they are tracker-driven, read only in the app, and no tracker feeds them any more). Everything else on the initiative stays;
--   3. with p_delete = true the live initiatives then go to the Trash with the existing delete_items() (recoverable for 30 days, ranks close up);
--   4. the light list of read Jira issues, the project link and the project's tracker are removed (the project has no tracker again).
--   Returns {released, cleared, deleted}. The old jira_unlink_project(uuid) (refuses while initiatives are linked) is left as it is.
-- jira_pull_in(ids, project, mode) is REPLACED (same signature and result): before it creates an initiative from a Jira issue it looks for an existing
--   initiative of the same project, with no tracker link, whose marker label the issue carries (pm:item/<hash of the initiative id>, or the name chosen in
--   stealth mode: any prefix ending in "/" and 16 hex digits). If there is one, the issue is linked to that initiative (owned by Product Velocity, link
--   mode push) instead of creating a duplicate. Nothing is written to Jira. No other open branch replaces it (checked 2026-11-18).
-- No DROP statements.

create function public.jira_unlink_project_release(p_project uuid, p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_all uuid[];
  v_live uuid[];
  v_cleared integer := 0;
  v_deleted integer := 0;
  r record;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can unlink a project from Jira.' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  select coalesce(array_agg(i.id), '{}') into v_all
    from public.items i where i.tenant_id = v_tenant and i.home_project_id = p_project
     and exists (select 1 from public.item_jira_links l where l.item_id = i.id);
  select coalesce(array_agg(i.id), '{}') into v_live
    from public.items i where i.id = any (v_all) and i.deleted_at is null;

  delete from public.item_jira_tree where item_id = any (v_all);
  delete from public.item_jira_epic_requests where item_id = any (v_all);
  delete from public.item_jira_links where item_id = any (v_all);
  update public.items set status = null, status_changed_at = null, issues_total = null, issues_closed = null, delivery_progress_pct = null
   where id = any (v_live);
  get diagnostics v_cleared = row_count;

  if p_delete and coalesce(array_length(v_live, 1), 0) > 0 then
    for r in select * from public.delete_items(v_live) loop
      if r.ok then v_deleted := v_deleted + 1;
      else raise exception 'Could not delete an initiative: %', coalesce(r.reason, 'unknown reason') using errcode = 'PV010';
      end if;
    end loop;
  end if;

  delete from public.jira_issues where project_id = p_project;
  delete from public.jira_project_links where project_id = p_project;
  update public.projects set tracker = null where id = p_project and tracker = 'jira';
  return jsonb_build_object('released', coalesce(array_length(v_all, 1), 0), 'cleared', v_cleared, 'deleted', v_deleted);
end $$;
revoke all on function public.jira_unlink_project_release(uuid, boolean) from public, anon;
grant execute on function public.jira_unlink_project_release(uuid, boolean) to authenticated;

create or replace function public.jira_pull_in(p_ids uuid[], p_project uuid, p_mode text default 'follow')
returns table (id uuid, ok boolean, reason text, item_id uuid, item_code text)
language plpgsql security definer set search_path = '' as $$
declare
  t public.jira_issues%rowtype;
  v_id uuid;
  v_item uuid;
  v_code text;
  v_tenant uuid;
  v_status text;
begin
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'Up to 200 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  if p_mode is null or p_mode not in ('follow', 'push') then raise exception 'Choose read only or ownership.' using errcode = '22023'; end if;
  select p.tenant_id into v_tenant from public.projects p where p.id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot add initiatives to that project.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects pr join public.jira_project_links l on l.project_id = pr.id where pr.id = p_project and pr.tracker = 'jira') then
    raise exception 'That project is not linked to a Jira project.' using errcode = 'PV008';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    select * into t from public.jira_issues x where x.id = v_id and x.tenant_id = v_tenant for update;
    if not found then return query select v_id, false, 'Issue not found.'::text, null::uuid, null::text; continue; end if;
    if t.project_id <> p_project then
      return query select v_id, false, 'This issue belongs to another project.'::text, null::uuid, null::text; continue;
    end if;
    if t.pull_state = 'pulled' and exists (select 1 from public.items i where i.id = t.item_id) then
      return query select v_id, false, 'Already an initiative.'::text, null::uuid, null::text; continue;
    end if;
    -- the issue already has an initiative: say so, fix the record, and do not create a second one
    select l.item_id, i.item_code into v_item, v_code from public.item_jira_links l join public.items i on i.id = l.item_id
     where l.connection_id = t.connection_id and l.site_id = t.site_id and l.issue_key = t.issue_key and i.deleted_at is null;
    if found then
      update public.jira_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, false, ('Already linked to ' || v_code || '.')::text, null::uuid, null::text; continue;
    end if;
    -- the issue carries the marker label of an initiative of this project that has no tracker link (an unlinked project's initiative): link that one
    v_item := null;
    select i.id, i.item_code into v_item, v_code from public.items i
     where i.tenant_id = v_tenant and i.home_project_id = p_project and i.deleted_at is null
       and not exists (select 1 from public.item_jira_links l where l.item_id = i.id)
       and not exists (select 1 from public.item_github_links g where g.item_id = i.id)
       and exists (select 1 from unnest(t.labels) lb
                    where lb ~ '^[A-Za-z0-9:_.-]{1,24}/[0-9a-f]{16}$'
                      and right(lb, 16) = left(encode(sha256(convert_to('pv-jira-marker:' || i.id::text, 'UTF8')), 'hex'), 16))
     order by i.created_at limit 1;
    if v_item is not null then
      begin
        insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, jira_status, jira_status_category, jira_updated_at)
        values (v_tenant, v_item, t.connection_id, t.site_id, t.issue_key, t.issue_id, t.html_url, 'push', t.status, t.status_category, t.jira_updated_at);
        v_status := case t.status_category when 'new' then 'Not started' when 'indeterminate' then 'In progress' when 'done' then 'Done' else null end;
        if v_status is not null then
          update public.items set status = v_status, status_changed_at = now(), last_synced_at = now() where items.id = v_item;
        end if;
        update public.jira_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
        return query select v_id, true, ('Linked again to ' || v_code || ' (found by its marker).')::text, v_item, v_code; continue;
      exception when others then
        return query select v_id, false, 'Could not link it to the initiative its marker names.'::text, null::uuid, null::text; continue;
      end;
    end if;
    begin
      insert into public.items (tenant_id, home_project_id, initiative_name, source)
      values (v_tenant, p_project, left(t.title, 200), 'Jira issue ' || t.issue_key)
      returning items.id, items.item_code into v_item, v_code;
      insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, jira_status, jira_status_category, jira_updated_at)
      values (v_tenant, v_item, t.connection_id, t.site_id, t.issue_key, t.issue_id, t.html_url, p_mode, t.status, t.status_category, t.jira_updated_at);
      -- Build Status follows the Jira status category (tracker-driven, read only); a project without a category yet stays empty
      v_status := case t.status_category when 'new' then 'Not started' when 'indeterminate' then 'In progress' when 'done' then 'Done' else null end;
      if v_status is not null then
        update public.items set status = v_status, status_changed_at = now(), last_synced_at = now() where items.id = v_item;
      end if;
      update public.jira_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, true, null::text, v_item, v_code;
    exception
      when unique_violation then
        return query select v_id, false, 'This issue is already linked to an initiative.'::text, null::uuid, null::text;
      when others then
        return query select v_id, false, 'Could not create the initiative.'::text, null::uuid, null::text;
    end;
  end loop;
end $$;
