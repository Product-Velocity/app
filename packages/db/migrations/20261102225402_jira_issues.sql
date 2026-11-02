-- Jira, slice C1 of issue #67 (with #69): read the open work of a linked Jira project into a light record per issue, the Jira twin of
-- tracker_issues (docs/16, decisions 2026-10-29 and 2026-11-02). Nothing becomes an initiative here: a "not pulled" issue is in no grid,
-- rank, cycle, report or push, and nothing is ever written to Jira from this table. Choosing what to pull in is slice C2.
-- jira_issues: key, title, type, labels, status and status CATEGORY, parent, link. pull_state: not_pulled (default), pulled, ignored.
--   Reading refreshes only the light fields and never changes pull_state of a known issue. pull_state, ignore_reason and item_id
--   changes are audited; the light fields are not (they are re-read every time).
-- jira_reads: when a linked project was last read and what came back (no audit: it changes on every read).
-- jira_upsert_issues() (service role): compare before write, so an unchanged issue costs no write; keys of another Jira project are refused.
-- jira_issue_counts(): issues per project and pull state, through the caller's own RLS.
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  project_id uuid not null,
  site_id text not null check (length(site_id) between 1 and 64),
  jira_project_key text not null check (jira_project_key ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  issue_key text not null check (issue_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  issue_id text check (issue_id ~ '^[0-9]{1,20}$'),
  title text not null check (char_length(title) <= 300),
  issue_type text check (char_length(issue_type) <= 80),
  hierarchy_level integer check (hierarchy_level between -5 and 10),
  labels text[] not null default '{}',
  status text check (char_length(status) <= 100),
  status_category text check (status_category in ('new', 'indeterminate', 'done')),
  parent_key text check (parent_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  html_url text check (html_url is null or html_url ~ '^https://'),
  pull_state text not null default 'not_pulled' check (pull_state in ('not_pulled', 'pulled', 'ignored')),
  ignore_reason text check (char_length(ignore_reason) <= 200),
  item_id uuid,
  jira_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, connection_id) references public.jira_connections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade,
  unique (connection_id, site_id, issue_key)
);
create index jira_issues_tenant_state on public.jira_issues (tenant_id, project_id, pull_state);
create trigger jira_issues_meta before insert or update on public.jira_issues
  for each row execute function public.set_write_meta();
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_issues
  for each row execute function platform.readonly_guard();

create function public.jira_issues_audit() returns trigger
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
      values (new.tenant_id, 'jira_issues', new.id, f, v_old -> f, v_new -> f, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;
create trigger jira_issues_audit after insert or update on public.jira_issues
  for each row execute function public.jira_issues_audit();
revoke all on function public.jira_issues_audit() from public, anon, authenticated;

alter table public.jira_issues enable row level security;
create policy jira_issues_select on public.jira_issues for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_issues from public, anon, authenticated;
grant select on public.jira_issues to authenticated;
grant all on public.jira_issues to service_role;

create table public.jira_reads (
  link_id uuid primary key references public.jira_project_links (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  read_at timestamptz not null default now(),
  total integer not null default 0,
  added integer not null default 0,
  changed integer not null default 0,
  truncated boolean not null default false,
  error text check (char_length(error) <= 300)
);
create index jira_reads_tenant_idx on public.jira_reads (tenant_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_reads
  for each row execute function platform.readonly_guard();
alter table public.jira_reads enable row level security;
create policy jira_reads_select on public.jira_reads for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_reads from public, anon, authenticated;
grant select on public.jira_reads to authenticated;
grant all on public.jira_reads to service_role;

-- rows = [{key, id, title, type, level, labels[], status, category, parent, url, updated}] for ONE link; returns {added, changed, unchanged}
create function public.jira_upsert_issues(p_link uuid, p_rows jsonb) returns jsonb
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
  return jsonb_build_object('added', v_added, 'changed', v_changed, 'unchanged', v_unchanged);
end $$;
revoke all on function public.jira_upsert_issues(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.jira_upsert_issues(uuid, jsonb) to service_role;

create function public.jira_issue_counts() returns table (project_id uuid, pull_state text, n bigint)
language sql stable set search_path = '' as $$
  select i.project_id, i.pull_state, count(*) from public.jira_issues i group by i.project_id, i.pull_state
$$;
revoke all on function public.jira_issue_counts() from public, anon;
grant execute on function public.jira_issue_counts() to authenticated;
