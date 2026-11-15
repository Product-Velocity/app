-- Epics coverage, GitHub twin (issue #465, part of #431; Jira side: 20261115222755_jira_epic_coverage.sql, issue #464).
-- On GitHub an "epic" is an open parent issue (an open issue that has sub-issues) of the repositories an admin ticked under
-- "Repositories to check for epics".
-- github_epic_repos: the repositories ticked (per connection). Only these are read. Nothing is written to GitHub.
-- github_epics_seen: the open parent issues last read from them (repository, number, title, type, parent, link, sub-issue count). Written ONLY by the
--   service role through github_replace_epics (one repository at a time: rows of that repository that are no longer open parents are removed).
--   Read-only for members. GitHub text is data: titles are cut to 300 characters. No bodies, comments or people are read or kept.
-- github_set_epic_repos(connection, repos[]): workspace admins who are people (not service accounts, not Claude); only repositories of that connection
--   that are not removed; replaces the ticked set, at most 30; audited.
-- RLS: tenant members read (fast pattern, index starts with tenant_id); nobody signed in writes the tables directly.
-- Functions replaced by this migration: none. No DROP statements.

create table public.github_epic_repos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id) on delete cascade,
  unique (tenant_id, connection_id, repo_full_name)
);
create index github_epic_repos_tenant on public.github_epic_repos (tenant_id, connection_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.github_epic_repos
  for each row execute function platform.readonly_guard();
create trigger github_epic_repos_audit after insert or update or delete on public.github_epic_repos
  for each row execute function public.audit_row();
alter table public.github_epic_repos enable row level security;
create policy github_epic_repos_select on public.github_epic_repos for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.github_epic_repos from public, anon, authenticated;
grant select on public.github_epic_repos to authenticated;
grant all on public.github_epic_repos to service_role;

create table public.github_epics_seen (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  issue_number integer not null check (issue_number > 0),
  title text not null check (char_length(title) <= 300),
  issue_type text check (issue_type is null or char_length(issue_type) <= 80),
  sub_issues_total integer not null default 0 check (sub_issues_total >= 0),
  parent_repo text check (parent_repo is null or parent_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  parent_number integer check (parent_number is null or parent_number > 0),
  html_url text check (html_url is null or html_url ~ '^https://'),
  gh_updated_at timestamptz,
  read_at timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id) on delete cascade,
  unique (tenant_id, connection_id, repo_full_name, issue_number),
  check ((parent_repo is null) = (parent_number is null))
);
create index github_epics_seen_tenant on public.github_epics_seen (tenant_id, repo_full_name, issue_number);
create trigger a_platform_readonly_guard before insert or update or delete on public.github_epics_seen
  for each row execute function platform.readonly_guard();
alter table public.github_epics_seen enable row level security;
create policy github_epics_seen_select on public.github_epics_seen for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.github_epics_seen from public, anon, authenticated;
grant select on public.github_epics_seen to authenticated;
grant all on public.github_epics_seen to service_role;

create function public.github_set_epic_repos(p_connection uuid, p_repos text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid := auth.uid();
  k text;
  v_n integer := 0;
begin
  select c.tenant_id into v_tenant from public.github_connections c where c.id = p_connection;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can choose the repositories to check for epics.' using errcode = '42501';
  end if;
  if p_repos is null or coalesce(array_length(p_repos, 1), 0) > 30 then raise exception 'Choose up to 30 repositories.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  foreach k in array coalesce(p_repos, '{}') loop
    if k is null or k !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then raise exception '% is not a repository name.', left(coalesce(k, ''), 60) using errcode = '22023'; end if;
    if not exists (select 1 from public.github_repositories r where r.connection_id = p_connection and r.removed_at is null and lower(r.full_name) = lower(k)) then
      raise exception '% is not available through this workspace''s GitHub connection.', left(k, 60) using errcode = '22023';
    end if;
  end loop;
  delete from public.github_epic_repos e where e.tenant_id = v_tenant and e.connection_id = p_connection and lower(e.repo_full_name) <> all (array (select lower(x) from unnest(coalesce(p_repos, '{}')) x));
  delete from public.github_epics_seen s where s.tenant_id = v_tenant and s.connection_id = p_connection and lower(s.repo_full_name) <> all (array (select lower(x) from unnest(coalesce(p_repos, '{}')) x));
  foreach k in array coalesce(p_repos, '{}') loop
    insert into public.github_epic_repos (tenant_id, connection_id, repo_full_name, created_by)
    select v_tenant, p_connection, r.full_name, v_actor from public.github_repositories r
     where r.connection_id = p_connection and r.removed_at is null and lower(r.full_name) = lower(k)
       and not exists (select 1 from public.github_epic_repos e where e.tenant_id = v_tenant and e.connection_id = p_connection and lower(e.repo_full_name) = lower(k));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.github_set_epic_repos(uuid, text[]) from public, anon;
grant execute on function public.github_set_epic_repos(uuid, text[]) to authenticated;

-- service role: replace what was read of one repository
-- (rows: number, title, type, subs, parent_repo, parent_number, url, updated)
create function public.github_replace_epics(p_tenant uuid, p_connection uuid, p_repo text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  v_repo text;
begin
  if p_repo !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad input' using errcode = '22023'; end if;
  select e.repo_full_name into v_repo from public.github_epic_repos e
   where e.tenant_id = p_tenant and e.connection_id = p_connection and lower(e.repo_full_name) = lower(p_repo);
  if v_repo is null then
    raise exception 'This repository is not ticked for epics.' using errcode = '22023';
  end if;
  insert into public.github_epics_seen (tenant_id, connection_id, repo_full_name, issue_number, title, issue_type, sub_issues_total, parent_repo, parent_number, html_url, gh_updated_at, read_at)
  select p_tenant, p_connection, v_repo, (r->>'number')::integer, left(coalesce(r->>'title', '(no title)'), 300), left(r->>'type', 80),
         greatest(coalesce((r->>'subs')::integer, 0), 0), nullif(r->>'parent_repo', ''), (r->>'parent_number')::integer, r->>'url', nullif(r->>'updated', '')::timestamptz, now()
    from jsonb_array_elements(p_rows) r
  on conflict (tenant_id, connection_id, repo_full_name, issue_number) do update
    set title = excluded.title, issue_type = excluded.issue_type, sub_issues_total = excluded.sub_issues_total, parent_repo = excluded.parent_repo,
        parent_number = excluded.parent_number, html_url = excluded.html_url, gh_updated_at = excluded.gh_updated_at, read_at = now();
  get diagnostics v_n = row_count;
  delete from public.github_epics_seen s
   where s.tenant_id = p_tenant and s.connection_id = p_connection and s.repo_full_name = v_repo
     and s.issue_number <> all (array (select (r->>'number')::integer from jsonb_array_elements(p_rows) r));
  return v_n;
end $$;
revoke all on function public.github_replace_epics(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.github_replace_epics(uuid, uuid, text, jsonb) to service_role;
