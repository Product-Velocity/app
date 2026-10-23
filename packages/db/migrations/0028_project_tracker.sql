-- 0028: a project has exactly one delivery tracker (docs/16 principle 1, Ashu 2026-10-23; issue #67).
-- projects.tracker: github, jira or gitlab; null means none yet. Every initiative in the project has at most one sync link, to that tracker.
--   An initiative never links to two trackers, because a project has one and an initiative lives in one project.
-- Guards (error code PV008):
--   * an initiative cannot get a GitHub link while its project uses another tracker; a project without a tracker becomes a GitHub project
--     at its first GitHub link (so GitHub behaves exactly as before);
--   * an initiative with a GitHub link cannot be moved into a project that uses another tracker;
--   * a project cannot change to another tracker while its initiatives have GitHub links, and a repository can be set only on a GitHub project.
-- Existing projects that already use GitHub (a default repository or linked initiatives) are marked github.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.projects add column tracker text check (tracker in ('github', 'jira', 'gitlab'));
grant insert (tracker) on public.projects to authenticated;
grant update (tracker) on public.projects to authenticated;

update public.projects p set tracker = 'github'
 where p.default_repo is not null
    or exists (select 1 from public.items i join public.item_github_links l on l.item_id = i.id where i.home_project_id = p.id);

create function public.projects_tracker_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tracker is not null and new.tracker <> 'github' and new.default_repo is not null then
    raise exception 'A repository can only be set on a GitHub project.' using errcode = 'PV008';
  end if;
  if tg_op = 'UPDATE' and new.tracker is distinct from old.tracker and new.tracker is distinct from 'github'
     and exists (select 1 from public.items i join public.item_github_links l on l.item_id = i.id where i.home_project_id = new.id) then
    raise exception 'This project already has GitHub links. Remove them, or move those initiatives, before changing the tracker.' using errcode = 'PV008';
  end if;
  return new;
end $$;
create trigger projects_tracker_guard before insert or update of tracker, default_repo on public.projects
  for each row execute function public.projects_tracker_guard();

create function public.item_github_links_project_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_tracker text;
begin
  select i.home_project_id, p.tracker into v_project, v_tracker
    from public.items i join public.projects p on p.id = i.home_project_id where i.id = new.item_id;
  if v_tracker is not null and v_tracker <> 'github' then
    raise exception 'This project is linked to % and a project has one tracker, so its initiatives cannot link to GitHub.', initcap(v_tracker) using errcode = 'PV008';
  end if;
  if v_tracker is null then
    update public.projects set tracker = 'github' where id = v_project;
  end if;
  return new;
end $$;
create trigger item_github_links_project_guard before insert on public.item_github_links
  for each row execute function public.item_github_links_project_guard();

create function public.items_project_move_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tracker text;
begin
  select p.tracker into v_tracker from public.projects p where p.id = new.home_project_id;
  if v_tracker is not null and v_tracker <> 'github'
     and exists (select 1 from public.item_github_links l where l.item_id = new.id) then
    raise exception 'This initiative has a GitHub link and the target project uses %.', initcap(v_tracker) using errcode = 'PV008';
  end if;
  return new;
end $$;
create trigger items_project_move_guard before update of home_project_id on public.items
  for each row execute function public.items_project_move_guard();
revoke all on function public.projects_tracker_guard(), public.item_github_links_project_guard(), public.items_project_move_guard() from public, anon, authenticated;

-- Pulling GitHub issues into a project of another tracker is refused up front with a clear message.
create or replace function public.tracker_pull_in(p_ids uuid[], p_project uuid)
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
    begin
      insert into public.items (tenant_id, home_project_id, initiative_name, source)
      values (v_tenant, p_project, left(t.title, 200), 'GitHub issue #' || t.issue_number)
      returning items.id, items.item_code into v_item, v_code;
      insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode, gh_closed_at)
      values (v_tenant, v_item, t.connection_id, t.repo_full_name, t.issue_number, t.issue_id, coalesce(t.html_url, 'https://github.com/' || t.repo_full_name || '/issues/' || t.issue_number), 'synced', 'follow',
              case when t.state = 'closed' then t.gh_updated_at end);
      perform public.github_apply_issue(t.connection_id, t.repo_full_name, t.issue_number, t.issue_id, null, t.state,
                                        t.state_reason, coalesce(t.gh_updated_at, now()));
      update public.tracker_issues x set pull_state = 'pulled', item_id = v_item, ignore_reason = null where x.id = v_id;
      return query select v_id, true, null::text, v_item, v_code;
    exception when others then
      return query select v_id, false, 'Could not create the initiative.'::text, null::uuid, null::text;
    end;
  end loop;
end $$;
