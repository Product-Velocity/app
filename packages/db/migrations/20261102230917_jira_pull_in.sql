-- Jira, slice C2a of issue #67 (with #76, #256): pull Jira issues in as initiatives, read only or owned by Product Velocity (docs/16, 21).
-- item_jira_links: the link between an initiative and ONE Jira issue (the twin of item_github_links, Jira's own table; GitHub stays as it is).
--   mode 'follow' (the initiative only reads from the issue) or 'push' (Product Velocity owns what the initiative IS; sent later through Sync
--   after a preview). Taking ownership writes nothing to Jira. Build Status stays tracker-driven and read only (rule 6): it follows the Jira
--   status CATEGORY at pull-in (new = Not started, indeterminate = In progress, done = Done). Initiative Status is never set from Jira.
-- jira_pull_in(ids, project, mode): editors (creators and admins) create initiatives from Not pulled issues of THAT project's Jira project.
-- jira_set_state(ids, state, reason): Not pulled <-> Ignored. item_set_jira_link_mode(item, mode): who owns a linked initiative.
-- Functions replaced by this migration: jira_unlink_project(uuid) and jira_disconnect(uuid), both created in this branch's earlier migrations
--   (no other open branch changes them). A project with Jira-linked initiatives cannot be unlinked (PV008); disconnecting keeps its links.
-- No DROP statements.

create table public.item_jira_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  connection_id uuid not null,
  site_id text not null check (length(site_id) between 1 and 64),
  issue_key text not null check (issue_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  issue_id text check (issue_id ~ '^[0-9]{1,20}$'),
  html_url text check (html_url is null or html_url ~ '^https://'),
  mode text not null default 'follow' check (mode in ('follow', 'push')),
  jira_status text check (char_length(jira_status) <= 100),
  jira_status_category text check (jira_status_category in ('new', 'indeterminate', 'done')),
  jira_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (item_id),
  unique (connection_id, site_id, issue_key),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id) references public.jira_connections (tenant_id, id)
);
create index item_jira_links_tenant_idx on public.item_jira_links (tenant_id, connection_id);
create trigger item_jira_links_meta before insert or update on public.item_jira_links
  for each row execute function public.set_write_meta();
create trigger item_jira_links_audit after insert or update or delete on public.item_jira_links
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.item_jira_links
  for each row execute function platform.readonly_guard();

-- an initiative has at most one tracker link: not a Jira link on top of a GitHub link
create function public.item_jira_links_one_tracker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.item_github_links g where g.item_id = new.item_id) then
    raise exception 'This initiative is linked to GitHub, and an initiative has one tracker.' using errcode = 'PV008';
  end if;
  return new;
end $$;
create trigger item_jira_links_one_tracker before insert on public.item_jira_links
  for each row execute function public.item_jira_links_one_tracker();
revoke all on function public.item_jira_links_one_tracker() from public, anon, authenticated;

alter table public.item_jira_links enable row level security;
create policy item_jira_links_select on public.item_jira_links for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.item_jira_links from public, anon, authenticated;
grant select on public.item_jira_links to authenticated;
grant all on public.item_jira_links to service_role;

-- Not pulled <-> Ignored (one call = one batch, so one undo step). A pulled issue changes only if its initiative no longer exists.
create function public.jira_set_state(p_ids uuid[], p_state text, p_reason text default null)
returns table (id uuid, ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  t public.jira_issues%rowtype;
  v_id uuid;
begin
  if p_state not in ('not_pulled', 'ignored') then raise exception 'Choose Not pulled or Ignored.' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Up to 500 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  foreach v_id in array coalesce(p_ids, '{}') loop
    select * into t from public.jira_issues x where x.id = v_id for update;
    if not found or t.tenant_id <> all (array (select public.my_editor_tenant_ids())) then
      return query select v_id, false, 'You cannot change this issue.'::text; continue;
    end if;
    if t.pull_state = 'pulled' and exists (select 1 from public.items i where i.id = t.item_id) then
      return query select v_id, false, 'This issue is already an initiative. Remove the initiative first.'::text; continue;
    end if;
    update public.jira_issues x set pull_state = p_state, item_id = null,
           ignore_reason = case when p_state = 'ignored' then left(nullif(btrim(coalesce(p_reason, '')), ''), 200) end
     where x.id = v_id;
    return query select v_id, true, null::text;
  end loop;
end $$;
revoke all on function public.jira_set_state(uuid[], text, text) from public, anon;
grant execute on function public.jira_set_state(uuid[], text, text) to authenticated;

-- Pull in = create an initiative that follows the issue (read only) or is owned by Product Velocity. Up to 200 at a time.
create function public.jira_pull_in(p_ids uuid[], p_project uuid, p_mode text default 'follow')
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
revoke all on function public.jira_pull_in(uuid[], uuid, text) from public, anon;
grant execute on function public.jira_pull_in(uuid[], uuid, text) to authenticated;

-- Changes who owns a Jira-linked initiative: 'push' = Product Velocity takes ownership, 'follow' = read only again. Returns the mode before.
create function public.item_set_jira_link_mode(p_item uuid, p_mode text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_jira_links%rowtype;
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
  select * into l from public.item_jira_links x where x.tenant_id = v_tenant and x.item_id = p_item for update;
  if not found then raise exception 'This initiative is not linked to a Jira issue.' using errcode = 'P0002'; end if;
  if l.mode = p_mode then return l.mode; end if;
  update public.item_jira_links x set mode = p_mode where x.id = l.id;
  return l.mode;
end $$;
revoke all on function public.item_set_jira_link_mode(uuid, text) from public, anon;
grant execute on function public.item_set_jira_link_mode(uuid, text) to authenticated;

-- A project with initiatives linked to Jira issues cannot be unlinked: remove those first (PV008).
create or replace function public.jira_unlink_project(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can unlink a project from Jira.' using errcode = '42501';
  end if;
  if exists (select 1 from public.item_jira_links l join public.items i on i.id = l.item_id where i.home_project_id = p_project) then
    raise exception 'This project has initiatives linked to Jira issues. Remove those initiatives first.' using errcode = 'PV008';
  end if;
  delete from public.jira_issues where project_id = p_project and pull_state <> 'pulled';
  delete from public.jira_project_links where project_id = p_project;
  update public.projects set tracker = null where id = p_project and tracker = 'jira';
end $$;

-- Ends a connection: the tokens are deleted at once. Projects whose initiatives are linked to Jira issues keep their link (and tracker), so
-- the initiatives stay consistent; the others are released together with the read issue list.
create or replace function public.jira_disconnect(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.jira_connections where id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can disconnect Jira.' using errcode = '42501';
  end if;
  delete from public.jira_credentials where connection_id = p_connection;
  update public.projects set tracker = null
   where tracker = 'jira'
     and id in (select l.project_id from public.jira_project_links l where l.connection_id = p_connection)
     and not exists (select 1 from public.item_jira_links x join public.items i on i.id = x.item_id where i.home_project_id = projects.id);
  delete from public.jira_issues where connection_id = p_connection and pull_state <> 'pulled'
     and project_id not in (select i.home_project_id from public.item_jira_links x join public.items i on i.id = x.item_id);
  delete from public.jira_project_links l where l.connection_id = p_connection
     and not exists (select 1 from public.item_jira_links x join public.items i on i.id = x.item_id where i.home_project_id = l.project_id);
  update public.jira_connections set state = 'disconnected' where id = p_connection and state <> 'disconnected';
end $$;
