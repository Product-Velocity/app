-- 0026: choose what comes in from the tracker (R-024, issue #76). Provider-neutral model, GitHub first.
-- tracker_issues: a light record (key, title, type, labels, status, link, parent) of every tracker issue the app has seen that is not
--   part of an initiative's own tree. pull_state: not_pulled (default), pulled (an initiative exists and follows the issue), ignored.
--   Not pulled and ignored issues are NOT items: they are in no grid, rank, cycle, report or push. Nothing is ever written to them.
--   Sync refreshes only the light fields; it never changes pull_state of a known issue. Written by the server and by the functions below.
-- tracker_rules: saved rules for NEW arrivals (type, label or repository -> ignore). Never applied to known issues or pulled-in items.
--   Rules are switched off with removed_at (rows are kept).
-- Audit: pull_state, ignore_reason and item_id changes are audited (actor, source, old and new); the light fields are not (they are
--   re-read on every sync).
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
create table public.tracker_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  provider text not null default 'github' check (provider in ('github')),
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  issue_number integer not null check (issue_number > 0),
  issue_id bigint,
  title text not null check (char_length(title) <= 300),
  issue_type text check (char_length(issue_type) <= 80),
  labels text[] not null default '{}',
  state text not null default 'open' check (state in ('open', 'closed')),
  state_reason text,
  parent_number integer check (parent_number > 0),
  html_url text check (html_url is null or html_url ~ '^https://'),
  pull_state text not null default 'not_pulled' check (pull_state in ('not_pulled', 'pulled', 'ignored')),
  ignore_reason text check (char_length(ignore_reason) <= 200),
  item_id uuid,
  gh_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id),
  unique (connection_id, repo_full_name, issue_number)
);
create index tracker_issues_tenant_state on public.tracker_issues (tenant_id, connection_id, pull_state);
create trigger tracker_issues_meta before insert or update on public.tracker_issues
  for each row execute function public.set_write_meta();

create function public.tracker_issues_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f text;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
begin
  foreach f in array array['pull_state', 'ignore_reason', 'item_id'] loop
    if (tg_op = 'UPDATE' or (tg_op = 'INSERT' and f <> 'item_id' and v_new -> f is not null and v_new -> f <> to_jsonb('not_pulled'::text)))
       and coalesce(v_old -> f, 'null'::jsonb) is distinct from coalesce(v_new -> f, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (new.tenant_id, 'tracker_issues', new.id, f, v_old -> f, v_new -> f, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;
create trigger tracker_issues_audit after insert or update on public.tracker_issues
  for each row execute function public.tracker_issues_audit();

alter table public.tracker_issues enable row level security;
create policy tracker_issues_select on public.tracker_issues for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.tracker_issues from public, anon, authenticated;
grant select on public.tracker_issues to authenticated;
grant all on public.tracker_issues to service_role;

create table public.tracker_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  kind text not null check (kind in ('type', 'label', 'repo')),
  value text not null check (char_length(value) between 1 and 120),
  action text not null default 'ignore' check (action in ('ignore')),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id)
);
create unique index tracker_rules_unique on public.tracker_rules (connection_id, kind, lower(value)) where removed_at is null;
create index tracker_rules_tenant on public.tracker_rules (tenant_id, connection_id);
create trigger tracker_rules_meta before insert or update on public.tracker_rules
  for each row execute function public.set_write_meta();
create trigger tracker_rules_audit after insert or update on public.tracker_rules
  for each row execute function public.audit_row();
alter table public.tracker_rules enable row level security;
create policy tracker_rules_select on public.tracker_rules for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.tracker_rules from public, anon, authenticated;
grant select on public.tracker_rules to authenticated;
grant all on public.tracker_rules to service_role;

-- Sync (service role): rows = [{repo, number, id, title, type, labels[], state, reason, parent, url, updated_at}]
create function public.tracker_upsert_issues(p_connection uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.github_connections%rowtype;
  r record;
  v_state text;
  v_reason text;
  v_item uuid;
  v_n integer := 0;
begin
  select * into c from public.github_connections where id = p_connection;
  if not found then raise exception 'Unknown connection.' using errcode = '22023'; end if;
  perform set_config('app.via', 'GitHub webhook', true);
  for r in
    select * from jsonb_to_recordset(p_rows) as x(repo text, number integer, id bigint, title text, type text, labels text[], state text,
                                                  reason text, parent integer, url text, updated_at timestamptz)
  loop
    -- the epics and tasks of an initiative's own tree are not incoming work
    if exists (select 1 from public.item_issue_tree t where t.tenant_id = c.tenant_id and lower(t.repo_full_name) = lower(r.repo) and t.issue_number = r.number) then
      continue;
    end if;
    update public.tracker_issues set
      issue_id = coalesce(r.id, issue_id), title = left(r.title, 300), issue_type = r.type, labels = coalesce(r.labels, '{}'),
      state = r.state, state_reason = r.reason, parent_number = r.parent, html_url = r.url, gh_updated_at = r.updated_at
     where connection_id = p_connection and lower(repo_full_name) = lower(r.repo) and issue_number = r.number
       and (gh_updated_at is null or r.updated_at is null or r.updated_at >= gh_updated_at);
    if found then v_n := v_n + 1; continue; end if;
    if exists (select 1 from public.tracker_issues where connection_id = p_connection and lower(repo_full_name) = lower(r.repo) and issue_number = r.number) then continue; end if;

    -- a new arrival: already an initiative's issue? a saved rule? otherwise Not pulled
    select l.item_id into v_item from public.item_github_links l
     where l.connection_id = p_connection and lower(l.repo_full_name) = lower(r.repo) and l.issue_number = r.number;
    v_state := 'not_pulled'; v_reason := null;
    if v_item is not null then
      v_state := 'pulled';
    else
      select 'Rule: ' || k.kind || ' ' || k.value into v_reason from public.tracker_rules k
       where k.connection_id = p_connection and k.removed_at is null and k.action = 'ignore'
         and ((k.kind = 'type' and lower(coalesce(r.type, '')) = lower(k.value))
           or (k.kind = 'label' and exists (select 1 from unnest(coalesce(r.labels, '{}')) lb where lower(lb) = lower(k.value)))
           or (k.kind = 'repo' and lower(r.repo) = lower(k.value)))
       order by k.created_at limit 1;
      if v_reason is not null then v_state := 'ignored'; end if;
    end if;
    insert into public.tracker_issues (tenant_id, connection_id, repo_full_name, issue_number, issue_id, title, issue_type, labels, state, state_reason,
                                       parent_number, html_url, pull_state, ignore_reason, item_id, gh_updated_at)
    values (c.tenant_id, p_connection, r.repo, r.number, r.id, left(r.title, 300), r.type, coalesce(r.labels, '{}'), r.state, r.reason, r.parent, r.url,
            v_state, v_reason, v_item, r.updated_at);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.tracker_upsert_issues(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tracker_upsert_issues(uuid, jsonb) to service_role;

-- People: Not pulled <-> Ignored (one call = one batch, so one undo step). A pulled issue changes only if its initiative no longer exists.
create function public.tracker_set_state(p_ids uuid[], p_state text, p_reason text default null)
returns table (id uuid, ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  t public.tracker_issues%rowtype;
  v_id uuid;
begin
  if p_state not in ('not_pulled', 'ignored') then raise exception 'Choose Not pulled or Ignored.' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Up to 500 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  foreach v_id in array coalesce(p_ids, '{}') loop
    select * into t from public.tracker_issues x where x.id = v_id for update;
    if not found or t.tenant_id <> all (array (select public.my_editor_tenant_ids())) then
      return query select v_id, false, 'You cannot change this issue.'::text; continue;
    end if;
    if t.pull_state = 'pulled' and exists (select 1 from public.items i where i.id = t.item_id) then
      return query select v_id, false, 'This issue is already an initiative. Remove the initiative first.'::text; continue;
    end if;
    update public.tracker_issues x set pull_state = p_state, item_id = null,
           ignore_reason = case when p_state = 'ignored' then left(nullif(btrim(coalesce(p_reason, '')), ''), 200) end
     where x.id = v_id;
    return query select v_id, true, null::text;
  end loop;
end $$;
revoke all on function public.tracker_set_state(uuid[], text, text) from public, anon;
grant execute on function public.tracker_set_state(uuid[], text, text) to authenticated;

-- People: Pull in = create an initiative that follows the issue read-only (Build Status then comes from the issue). Up to 200 at a time.
create function public.tracker_pull_in(p_ids uuid[], p_project uuid)
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
revoke all on function public.tracker_pull_in(uuid[], uuid) from public, anon;
grant execute on function public.tracker_pull_in(uuid[], uuid) to authenticated;

-- Admins: rules for new arrivals
create function public.tracker_rule_add(p_connection uuid, p_kind text, p_value text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.github_connections where id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'Only admins can change the rules.' using errcode = '42501';
  end if;
  insert into public.tracker_rules (tenant_id, connection_id, kind, value) values (v_tenant, p_connection, p_kind, btrim(p_value)) returning tracker_rules.id into v_id;
  return v_id;
end $$;
revoke all on function public.tracker_rule_add(uuid, text, text) from public, anon;
grant execute on function public.tracker_rule_add(uuid, text, text) to authenticated;

create function public.tracker_rule_remove(p_rule uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.tracker_rules where id = p_rule;
  if v_tenant is null or v_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'Only admins can change the rules.' using errcode = '42501';
  end if;
  update public.tracker_rules set removed_at = now() where id = p_rule and removed_at is null;
end $$;
revoke all on function public.tracker_rule_remove(uuid) from public, anon;
grant execute on function public.tracker_rule_remove(uuid) to authenticated;
