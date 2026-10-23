-- 0021: repositories the app must never write to (decision 2026-10-23, after "all repositories" was enabled on the sandbox App).
-- github_repositories.access: 'read_write' (default for private repositories) or 'read_only' (default for public ones, such as the
--   real build repo). A read-only repository cannot be a project's default repository, a push to it is refused in the app and in
--   github_record_push (PV007), and an admin can change it with github_set_repo_access().
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.github_repositories add column access text not null default 'read_write' check (access in ('read_write', 'read_only'));
update public.github_repositories set access = 'read_only' where not is_private;

create or replace function public.projects_default_repo_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.default_repo is not null and (tg_op = 'INSERT' or new.default_repo is distinct from old.default_repo) then
    if not exists (
      select 1 from public.github_repositories r
      where r.tenant_id = new.tenant_id and r.removed_at is null and r.access = 'read_write' and lower(r.full_name) = lower(new.default_repo)
    ) then
      raise exception 'default repository % is not available through this workspace''s GitHub connection, or it is read-only', new.default_repo
        using errcode = 'PV005';
    end if;
  end if;
  return new;
end $$;

create function public.github_set_repo_access(p_repo uuid, p_access text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_name text;
begin
  select tenant_id, full_name into v_tenant, v_name from public.github_repositories where id = p_repo;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'Claude MCP' then
    raise exception 'Only a workspace admin can change repository access.' using errcode = '42501';
  end if;
  if p_access not in ('read_write', 'read_only') then raise exception 'bad access' using errcode = '22023'; end if;
  update public.github_repositories set access = p_access where id = p_repo;
  if p_access = 'read_only' then
    update public.projects set default_repo = null where tenant_id = v_tenant and lower(default_repo) = lower(v_name);
  end if;
end $$;
revoke all on function public.github_set_repo_access(uuid, text) from public, anon;
grant execute on function public.github_set_repo_access(uuid, text) to authenticated;

create or replace function public.github_record_push(
  p_actor uuid, p_item uuid, p_connection uuid, p_repo text, p_number integer, p_issue_id bigint,
  p_node_id text, p_url text, p_hash text, p_state text, p_error text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can push an item to GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.github_connections c where c.id = p_connection and c.tenant_id = v_tenant and c.state = 'connected') then
    raise exception 'The workspace is not connected to GitHub.' using errcode = '42501';
  end if;
  if p_state not in ('pending', 'synced', 'error') then raise exception 'bad sync state' using errcode = '22023'; end if;
  if exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'follow') then
    raise exception 'This item follows an existing GitHub issue read-only; pushing to it is switched off.' using errcode = 'PV006';
  end if;
  if exists (select 1 from public.github_repositories r where r.tenant_id = v_tenant and r.removed_at is null and r.access = 'read_only' and lower(r.full_name) = lower(p_repo)) then
    raise exception 'The repository % is marked read-only; the app never writes to it.', p_repo using errcode = 'PV007';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who confirmed
  insert into public.item_github_links as l (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, issue_node_id, html_url, sync_state, last_error, last_pushed_hash, last_pushed_at)
  values (v_tenant, p_item, p_connection, p_repo, p_number, p_issue_id, p_node_id, p_url, p_state, left(p_error, 300),
          case when p_state = 'synced' then p_hash end, case when p_state = 'synced' then now() end)
  on conflict (tenant_id, item_id) do update set
    connection_id = excluded.connection_id,
    repo_full_name = excluded.repo_full_name,
    issue_number = coalesce(excluded.issue_number, l.issue_number),
    issue_id = coalesce(excluded.issue_id, l.issue_id),
    issue_node_id = coalesce(excluded.issue_node_id, l.issue_node_id),
    html_url = coalesce(excluded.html_url, l.html_url),
    sync_state = excluded.sync_state,
    last_error = excluded.last_error,
    last_pushed_hash = case when excluded.sync_state = 'synced' then excluded.last_pushed_hash else l.last_pushed_hash end,
    last_pushed_at = case when excluded.sync_state = 'synced' then now() else l.last_pushed_at end
  returning id into v_id;
  return v_id;
end $$;
