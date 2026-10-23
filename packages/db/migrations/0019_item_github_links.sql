-- 0019: one GitHub tracking issue per initiative (issue #33).
-- item_github_links: the link between an item and its issue (the "GitHub Links" field), with the sync state and a hash of
--   what was last sent, so pushing an unchanged item sends nothing and a retry never creates a second issue.
-- Nobody signed in writes it directly. The server writes it through github_record_push() on behalf of the person who
--   confirmed the push: the function checks that person is a creator or admin (not a service account) of the item's
--   workspace and that the connection is connected, and records them as the actor in the audit log.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
create table public.item_github_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  connection_id uuid not null,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  issue_number integer check (issue_number > 0),
  issue_id bigint,
  issue_node_id text,
  html_url text check (html_url is null or html_url ~ '^https://'),
  sync_state text not null default 'pending' check (sync_state in ('pending', 'synced', 'error')),
  last_error text check (char_length(last_error) <= 300),
  last_pushed_hash text,
  last_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id),
  unique (tenant_id, item_id),
  check (sync_state <> 'synced' or (issue_number is not null and issue_id is not null and html_url is not null))
);
create unique index item_github_links_issue on public.item_github_links (connection_id, repo_full_name, issue_number)
  where issue_number is not null;
create trigger item_github_links_meta before insert or update on public.item_github_links
  for each row execute function public.set_write_meta();
create trigger item_github_links_audit after insert or update or delete on public.item_github_links
  for each row execute function public.audit_row();

alter table public.item_github_links enable row level security;
create policy item_github_links_select on public.item_github_links for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.item_github_links from public, anon, authenticated;
grant select on public.item_github_links to authenticated;
grant all on public.item_github_links to service_role;

create function public.github_record_push(
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
revoke all on function public.github_record_push(uuid, uuid, uuid, text, integer, bigint, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.github_record_push(uuid, uuid, uuid, text, integer, bigint, text, text, text, text, text) to service_role;
