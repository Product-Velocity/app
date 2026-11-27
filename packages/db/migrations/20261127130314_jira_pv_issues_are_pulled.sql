-- An issue that Product Velocity created in Jira, or any issue that is already linked to an initiative, is not "new in Jira" (issue 740, Ashu 2026-11-27).
-- Found on R89 after the first Sync of R-102 to RR-7: the inbox ("New issues in Jira", tab Not pulled) offered RR-7 for pull-in although Product Velocity had created it
-- and the link existed. jira_issues (the light record the project read keeps) was created by the next read as Not pulled, because neither the read nor the create-link
-- knew about the other. Pull in itself was safe (jira_pull_in answers "Already linked to R-102" and creates no second initiative), but the offer was wrong.
--   * jira_create_link: after linking, the issue's light record (when it exists) becomes Pulled with the initiative, so it never shows as new.
--   * jira_upsert_issues: after a read, every Not pulled record of that project that has a link to a live initiative becomes Pulled with that initiative (one statement
--     per read, so a record created by the read itself is covered too). Ignored records are left alone; a removed initiative's link does not count.
--   * a one-off repair of the records that are in this state now (RR-7 on R89; 1 row in production).
-- Every state change is audited by the table's audit trigger (source system or UI). Functions replaced (same signatures, so the grants stay): jira_create_link(uuid, uuid,
-- uuid, text, text, text, text, jsonb, text), last in 20261103094723_jira_sync_write.sql, and jira_upsert_issues(uuid, jsonb), last in 20261102225402_jira_issues.sql; no other
-- open branch replaces them (checked against the open pull requests on 2026-11-27). No DROP statements.

create or replace function public.jira_create_link(p_actor uuid, p_item uuid, p_connection uuid, p_site text, p_key text, p_issue_id text, p_url text, p_base jsonb, p_sent_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_project uuid;
begin
  select tenant_id, home_project_id into v_tenant, v_project from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can sync an item with Jira.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.jira_project_links pl
    where pl.tenant_id = v_tenant and pl.project_id = v_project and pl.connection_id = p_connection and pl.site_id = p_site
      and p_key like pl.jira_project_key || '-%'
  ) then
    raise exception 'That Jira issue does not belong to this initiative''s Jira project.' using errcode = 'PV008';
  end if;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, sync_base, sent_hash, sync_checked_at, created_by, created_via)
  values (v_tenant, p_item, p_connection, p_site, p_key, p_issue_id, p_url, 'push', p_base, p_sent_hash, now(), p_actor, 'UI');
  -- the light record of this issue (if a read already made one) is the initiative's own issue now, not a new one
  update public.jira_issues set pull_state = 'pulled', item_id = p_item, ignore_reason = null
   where tenant_id = v_tenant and connection_id = p_connection and site_id = p_site and issue_key = p_key and pull_state <> 'pulled';
end $$;

create or replace function public.jira_upsert_issues(p_link uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.jira_project_links%rowtype;
  r record;
  v_added integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_rows integer;
begin
  select * into l from public.jira_project_links where id = p_link;
  if not found then raise exception 'Unknown link.' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'Up to 1000 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);
  for r in
    select * from jsonb_to_recordset(p_rows) as x(key text, id text, title text, type text, level integer, labels text[], status text,
                                                 category text, parent text, url text, updated timestamptz)
  loop
    -- a link reads its own Jira project only
    if r.key is null or r.key not like l.jira_project_key || '-%' then continue; end if;
    update public.jira_issues set
      issue_id = coalesce(r.id, issue_id), title = left(r.title, 300), issue_type = r.type, hierarchy_level = r.level, labels = coalesce(r.labels, '{}'),
      status = r.status, status_category = r.category, parent_key = r.parent, html_url = r.url, jira_updated_at = r.updated
     where connection_id = l.connection_id and site_id = l.site_id and issue_key = r.key
       and (jira_updated_at is null or r.updated is null or r.updated >= jira_updated_at)
       and (title, issue_type, hierarchy_level, labels, status, status_category, parent_key, html_url, jira_updated_at)
           is distinct from (left(r.title, 300), r.type, r.level, coalesce(r.labels, '{}'), r.status, r.category, r.parent, r.url, r.updated);
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_changed := v_changed + 1; continue; end if;
    if exists (select 1 from public.jira_issues where connection_id = l.connection_id and site_id = l.site_id and issue_key = r.key) then
      v_unchanged := v_unchanged + 1; continue;
    end if;
    insert into public.jira_issues (tenant_id, connection_id, project_id, site_id, jira_project_key, issue_key, issue_id, title, issue_type, hierarchy_level,
                                    labels, status, status_category, parent_key, html_url, jira_updated_at)
    values (l.tenant_id, l.connection_id, l.project_id, l.site_id, l.jira_project_key, r.key, r.id, left(r.title, 300), r.type, r.level,
            coalesce(r.labels, '{}'), r.status, r.category, r.parent, r.url, r.updated);
    v_added := v_added + 1;
  end loop;
  -- an issue that is already linked to a live initiative (Product Velocity created it, or it was linked another way) is not new in Jira
  update public.jira_issues x set pull_state = 'pulled', item_id = k.item_id, ignore_reason = null
    from public.item_jira_links k join public.items it on it.id = k.item_id and it.deleted_at is null
   where x.tenant_id = l.tenant_id and x.project_id = l.project_id and x.pull_state = 'not_pulled'
     and k.tenant_id = x.tenant_id and k.connection_id = x.connection_id and k.site_id = x.site_id and k.issue_key = x.issue_key;
  return jsonb_build_object('added', v_added, 'changed', v_changed, 'unchanged', v_unchanged);
end $$;

-- one-off repair of the records that are in this state now
select set_config('app.via', 'system', true);
update public.jira_issues x set pull_state = 'pulled', item_id = k.item_id, ignore_reason = null
  from public.item_jira_links k join public.items it on it.id = k.item_id and it.deleted_at is null
 where x.pull_state = 'not_pulled' and k.tenant_id = x.tenant_id and k.connection_id = x.connection_id and k.site_id = x.site_id and k.issue_key = x.issue_key;
