-- 0020: links that only follow a GitHub issue (Ashu's decision 2026-10-23, option "the real issues, read-only").
-- mode 'push' (default): the item owns a tracking issue the app creates and updates (#33).
-- mode 'follow': the item points at an existing issue and only reads from it; pushing to it is refused here and in the app,
--   so the real build backlog is never written to by a test or by mistake. Status and progress flow in from GitHub (#32, #35).
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.item_github_links add column mode text not null default 'push' check (mode in ('push', 'follow'));

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
