-- Who owns a pulled-in item: read only (the initiative follows the tracker issue) or Product Velocity (request 253, issue #256).
--
-- Functions replaced: tracker_pull_in (gains p_mode, 'follow' by default, so every existing caller behaves as before). New: item_set_link_mode.
--
-- link mode 'follow': the initiative only reads from the issue (today's pull-in). 'push': Product Velocity owns what the initiative IS
-- (name, summary, description, hypothesis, board values) and sends it through Sync after a preview and a confirmation. Taking ownership
-- writes nothing to the tracker by itself. Status, progress, PR and CI stay read-only in both modes (rule 6).
-- The change of mode is audited by item_github_links_audit (actor, source, old and new value), so it can be undone from the log.

drop function public.tracker_pull_in(uuid[], uuid);

create function public.tracker_pull_in(p_ids uuid[], p_project uuid, p_mode text default 'follow')
returns table (id uuid, ok boolean, reason text, item_id uuid, item_code text)
language plpgsql security definer set search_path = '' as $$
declare
  t public.tracker_issues%rowtype;
  v_id uuid;
  v_item uuid;
  v_code text;
  v_tenant uuid;
begin
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'Up to 200 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  if p_mode is null or p_mode not in ('follow', 'push') then raise exception 'Choose read only or ownership.' using errcode = '22023'; end if;
  select p.tenant_id into v_tenant from public.projects p where p.id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot add initiatives to that project.' using errcode = '42501';
  end if;
  if exists (select 1 from public.projects pr where pr.id = p_project and pr.tracker is not null and pr.tracker <> 'github') then
    raise exception 'That project is linked to another tracker, so it cannot take GitHub issues.' using errcode = 'PV008';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    select * into t from public.tracker_issues x where x.id = v_id and x.tenant_id = v_tenant for update;
    if not found then return query select v_id, false, 'Issue not found.'::text, null::uuid, null::text; continue; end if;
    if t.pull_state = 'pulled' and exists (select 1 from public.items i where i.id = t.item_id) then
      return query select v_id, false, 'Already an initiative.'::text, null::uuid, null::text; continue;
    end if;
    -- the issue already has an initiative (for example one PV pushed): say so, fix the record, and do not create a second one
    select l.item_id, i.item_code into v_item, v_code from public.item_github_links l join public.items i on i.id = l.item_id
     where l.connection_id = t.connection_id and lower(l.repo_full_name) = lower(t.repo_full_name) and l.issue_number = t.issue_number and i.deleted_at is null;
    if found then
      update public.tracker_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, false, ('Already linked to ' || v_code || '.')::text, null::uuid, null::text; continue;
    end if;
    begin
      insert into public.items (tenant_id, home_project_id, initiative_name, source)
      values (v_tenant, p_project, left(t.title, 200), 'GitHub issue #' || t.issue_number)
      returning items.id, items.item_code into v_item, v_code;
      insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode, gh_closed_at)
      values (v_tenant, v_item, t.connection_id, t.repo_full_name, t.issue_number, t.issue_id, coalesce(t.html_url, 'https://github.com/' || t.repo_full_name || '/issues/' || t.issue_number), 'synced', p_mode,
              case when t.state = 'closed' then t.gh_updated_at end);
      perform public.github_apply_issue(t.connection_id, t.repo_full_name, t.issue_number, t.issue_id, null, t.state,
                                        t.state_reason, coalesce(t.gh_updated_at, now()));
      update public.tracker_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, true, null::text, v_item, v_code;
    exception
      when unique_violation then
        return query select v_id, false, 'This issue is already linked to an initiative.'::text, null::uuid, null::text;
      when others then
        return query select v_id, false, 'Could not create the initiative.'::text, null::uuid, null::text;
    end;
  end loop;
end $$;
revoke all on function public.tracker_pull_in(uuid[], uuid, text) from public, anon;
grant execute on function public.tracker_pull_in(uuid[], uuid, text) to authenticated;

-- Changes who owns a linked initiative: 'push' = Product Velocity takes ownership, 'follow' = read only again.
-- Creators and admins of the workspace; nothing is written to the tracker. Returns the mode before, so a caller can undo.
create function public.item_set_link_mode(p_item uuid, p_mode text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_github_links%rowtype;
  v_tenant uuid;
  v_actor uuid := auth.uid();
begin
  if p_mode is null or p_mode not in ('follow', 'push') then raise exception 'Choose read only or ownership.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  select i.tenant_id into v_tenant from public.items i where i.id = p_item and i.deleted_at is null;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot change this initiative.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = v_actor and m.is_service_account) then
    raise exception 'A service account cannot change who owns an initiative.' using errcode = '42501';
  end if;
  select * into l from public.item_github_links x where x.tenant_id = v_tenant and x.item_id = p_item for update;
  if not found then raise exception 'This initiative is not linked to an issue.' using errcode = 'P0002'; end if;
  if l.mode = p_mode then return l.mode; end if;
  update public.item_github_links x set mode = p_mode where x.id = l.id;
  return l.mode;
end $$;
revoke all on function public.item_set_link_mode(uuid, text) from public, anon;
grant execute on function public.item_set_link_mode(uuid, text) to authenticated;
