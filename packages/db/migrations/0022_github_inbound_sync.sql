-- 0022: GitHub changes come back into the app (issues #32 and the first part of #35).
-- sync_events: the sync log. One row per GitHub delivery (or reconciliation finding) that touches a linked item, keyed by
--   X-GitHub-Delivery so a replay changes nothing. Only the few fields needed to apply or retry it are kept (never titles,
--   bodies, comments or emails). Admins read it (this is also the dead-letter list); only the server writes it.
-- item_github_links.gh_state / gh_last_activity / gh_synced_at: what GitHub last said about the linked issue.
-- github_apply_issue(): applies an issue's state to its linked item in one transaction. Closed as completed gives Completed,
--   closed as not planned gives Cancelled, reopened gives Not Started, a first look at an open issue gives Backlog when the
--   item has no status. Older information than what is already recorded changes nothing. Called by the server only.
-- item_stage_durations(): how long each item spent in each Status and Initiative Phase, from the audit log, for flow and speed.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.item_github_links
  add column gh_state text check (gh_state in ('open', 'closed_completed', 'closed_not_planned')),
  add column gh_last_activity timestamptz,
  add column gh_synced_at timestamptz;

create table public.sync_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  delivery_id text not null unique,
  source text not null default 'webhook' check (source in ('webhook', 'reconcile')),
  event text not null check (char_length(event) <= 60),
  action text check (char_length(action) <= 60),
  repo_full_name text,
  issue_number integer,
  summary jsonb not null default '{}',
  state text not null default 'received' check (state in ('received', 'processed', 'ignored', 'error')),
  attempts integer not null default 0,
  last_error text check (char_length(last_error) <= 300),
  item_id uuid,
  applied jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (tenant_id, connection_id) references public.github_connections (tenant_id, id)
);
create index sync_events_tenant_idx on public.sync_events (tenant_id, received_at desc);
create index sync_events_errors_idx on public.sync_events (tenant_id) where state = 'error';

alter table public.sync_events enable row level security;
create policy sync_events_select on public.sync_events for select to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.sync_events from public, anon, authenticated;
grant select on public.sync_events to authenticated;
grant all on public.sync_events to service_role;

create function public.github_apply_issue(
  p_connection uuid, p_repo text, p_number integer, p_issue_id bigint, p_node_id text,
  p_state text, p_state_reason text, p_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.item_github_links%rowtype;
  v_gh text;
  v_old text;
  v_new text;
  v_changes jsonb := '{}'::jsonb;
begin
  if p_state not in ('open', 'closed') then raise exception 'bad issue state' using errcode = '22023'; end if;
  select * into l from public.item_github_links
   where connection_id = p_connection and lower(repo_full_name) = lower(p_repo) and issue_number = p_number
   for update;
  if not found then return null; end if;

  v_gh := case when p_state = 'open' then 'open' when p_state_reason = 'not_planned' then 'closed_not_planned' else 'closed_completed' end;
  if l.gh_last_activity is not null and p_updated_at < l.gh_last_activity then
    return jsonb_build_object('item_id', l.item_id, 'stale', true, 'changes', '{}'::jsonb); -- older than what we already know
  end if;

  update public.item_github_links set
    gh_state = v_gh, gh_last_activity = p_updated_at, gh_synced_at = now(),
    issue_id = coalesce(p_issue_id, issue_id), issue_node_id = coalesce(p_node_id, issue_node_id),
    sync_state = case when l.mode = 'follow' and coalesce(p_issue_id, l.issue_id) is not null then 'synced' else l.sync_state end,
    last_error = case when l.mode = 'follow' then null else l.last_error end
   where id = l.id;
  if l.gh_state is distinct from v_gh then v_changes := v_changes || jsonb_build_object('gh_state', jsonb_build_array(l.gh_state, v_gh)); end if;

  select status into v_old from public.items where id = l.item_id;
  v_new := case v_gh
    when 'closed_completed' then 'Completed'
    when 'closed_not_planned' then 'Cancelled'
    else case when l.gh_state in ('closed_completed', 'closed_not_planned') and v_old in ('Completed', 'Cancelled') then 'Not Started' else null end
  end;
  if v_new is null and v_gh = 'open' and v_old is null then v_new := 'Backlog'; end if;
  if v_new is not null and v_new is distinct from v_old then
    update public.items set status = v_new, status_changed_at = now(), last_synced_at = now() where id = l.item_id;
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(v_old, v_new));
  end if;
  return jsonb_build_object('item_id', l.item_id, 'stale', false, 'changes', v_changes);
end $$;
revoke all on function public.github_apply_issue(uuid, text, integer, bigint, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.github_apply_issue(uuid, text, integer, bigint, text, text, text, timestamptz) to service_role;

create function public.item_stage_durations(p_tenant uuid)
returns table (item_id uuid, field text, value text, entered_at timestamptz, left_at timestamptz, days numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select s.entity_id, s.field, s.value, s.at, s.next_at,
           round(extract(epoch from (coalesce(s.next_at, now()) - s.at)) / 86400, 2)
    from (
      select a.entity_id, a.field, a.new #>> '{}' as value, a.at,
             lead(a.at) over (partition by a.entity_id, a.field order by a.at, a.id) as next_at
      from public.audit_log a
      where a.tenant_id = p_tenant and a.entity = 'items' and a.field in ('status', 'initiative_phase')
    ) s
    where s.entity_id in (select i.id from public.items i where i.tenant_id = p_tenant and i.deleted_at is null)
    order by s.entity_id, s.field, s.at;
end $$;
revoke all on function public.item_stage_durations(uuid) from public, anon;
grant execute on function public.item_stage_durations(uuid) to authenticated;
