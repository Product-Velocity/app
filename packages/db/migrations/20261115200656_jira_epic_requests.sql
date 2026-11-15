-- Epic keys at creation (issue #431, docs/decisions/2026-11-13-tracker-initiative-level.md): a person who already knows which Jira epics belong
-- under an initiative (a Jira Initiative, above Epic) lists their keys on the initiative; Sync with Jira, after a preview and a confirmation,
-- creates the Initiative (if needed) and sets each epic's parent to it. Nothing is written to Jira from here: this only records the request.
-- item_jira_epic_requests: one row per (initiative, epic key). state: pending (asked for), linked (Sync set the parent), failed (Jira refused;
--   last_error says why, short, as plain text). previous_parent = the epic's parent before Sync moved it (null = it had none), kept so a person
--   can put it back. An epic key can be wanted by ONE initiative at a time (partial unique index over pending and linked). RLS: tenant members
--   read (fast pattern, index starts with tenant_id); nobody signed in writes the table directly, only the functions below. Audited (audit_row).
-- item_request_jira_epics(item, keys[]): creators and admins (not service accounts) of the workspace; up to 50 keys; refuses a key that is already
--   wanted by another initiative or that is the Jira issue of an initiative of its own; a failed request of the same initiative is asked for again.
--   Returns the keys that were newly requested.
-- item_remove_jira_epic_request(item, key): removes a pending or failed request (a linked one is already in Jira).
-- jira_record_epic_link(actor, item, key, ok, previous_parent, error): service role only; Sync records the outcome, audited as the person.
-- Functions replaced by this migration: none. No DROP statements.

create table public.item_jira_epic_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  epic_key text not null check (epic_key ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  state text not null default 'pending' check (state in ('pending', 'linked', 'failed')),
  previous_parent text check (previous_parent is null or previous_parent ~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$'),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_at timestamptz,
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  unique (item_id, epic_key)
);
create unique index item_jira_epic_requests_one_owner on public.item_jira_epic_requests (tenant_id, epic_key) where state in ('pending', 'linked');
create index item_jira_epic_requests_tenant_item on public.item_jira_epic_requests (tenant_id, item_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.item_jira_epic_requests
  for each row execute function platform.readonly_guard();
create trigger item_jira_epic_requests_audit after insert or update or delete on public.item_jira_epic_requests
  for each row execute function public.audit_row();
alter table public.item_jira_epic_requests enable row level security;
create policy item_jira_epic_requests_select on public.item_jira_epic_requests for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.item_jira_epic_requests from public, anon, authenticated;
grant select on public.item_jira_epic_requests to authenticated;
grant all on public.item_jira_epic_requests to service_role;

create function public.item_request_jira_epics(p_item uuid, p_keys text[])
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid := auth.uid();
  k text;
  v_new text[] := '{}';
  v_state text;
begin
  select i.tenant_id into v_tenant from public.items i where i.id = p_item and i.deleted_at is null;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot change this initiative.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = v_actor and m.is_service_account) then
    raise exception 'A service account cannot ask for epics.' using errcode = '42501';
  end if;
  if p_keys is null or coalesce(array_length(p_keys, 1), 0) < 1 or array_length(p_keys, 1) > 50 then raise exception 'Give between 1 and 50 epic keys.' using errcode = '22023'; end if;
  if exists (select 1 from public.item_jira_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'follow') then
    raise exception 'This initiative follows its Jira issue read-only: take ownership first.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.items i join public.jira_project_links pl on pl.tenant_id = i.tenant_id and pl.project_id = i.home_project_id where i.id = p_item) then
    raise exception 'This initiative''s project is not linked to a Jira project.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  foreach k in array p_keys loop
    if k is null or k !~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$' then raise exception '% is not a Jira issue key.', left(coalesce(k, ''), 30) using errcode = '22023'; end if;
    if exists (select 1 from public.item_jira_links l where l.tenant_id = v_tenant and l.issue_key = k) then
      raise exception '% is already the Jira issue of an initiative.', k using errcode = '23505';
    end if;
    if exists (select 1 from public.item_jira_epic_requests r where r.tenant_id = v_tenant and r.epic_key = k and r.item_id <> p_item and r.state in ('pending', 'linked')) then
      raise exception '% is already wanted by another initiative.', k using errcode = '23505';
    end if;
    select r.state into v_state from public.item_jira_epic_requests r where r.item_id = p_item and r.epic_key = k;
    if not found then
      insert into public.item_jira_epic_requests (tenant_id, item_id, epic_key, requested_by) values (v_tenant, p_item, k, v_actor);
      v_new := v_new || k;
    elsif v_state = 'failed' then
      update public.item_jira_epic_requests r set state = 'pending', last_error = null, updated_at = now() where r.item_id = p_item and r.epic_key = k;
      v_new := v_new || k;
    end if;
  end loop;
  return v_new;
end $$;
revoke all on function public.item_request_jira_epics(uuid, text[]) from public, anon;
grant execute on function public.item_request_jira_epics(uuid, text[]) to authenticated;

create function public.item_remove_jira_epic_request(p_item uuid, p_key text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid := auth.uid();
  v_n integer;
begin
  select i.tenant_id into v_tenant from public.items i where i.id = p_item and i.deleted_at is null;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot change this initiative.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = v_actor and m.is_service_account) then
    raise exception 'A service account cannot remove an epic request.' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  delete from public.item_jira_epic_requests r where r.tenant_id = v_tenant and r.item_id = p_item and r.epic_key = p_key and r.state in ('pending', 'failed');
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.item_remove_jira_epic_request(uuid, text) from public, anon;
grant execute on function public.item_remove_jira_epic_request(uuid, text) to authenticated;

create function public.jira_record_epic_link(p_actor uuid, p_item uuid, p_key text, p_ok boolean, p_previous_parent text, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can sync an item with Jira.' using errcode = '42501';
  end if;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_jira_epic_requests r set
    state = case when p_ok then 'linked' else 'failed' end,
    previous_parent = case when p_ok then p_previous_parent else r.previous_parent end,
    last_error = case when p_ok then null else left(coalesce(p_error, 'Jira refused it.'), 300) end,
    linked_at = case when p_ok then now() else r.linked_at end,
    updated_at = now()
   where r.tenant_id = v_tenant and r.item_id = p_item and r.epic_key = p_key and r.state in ('pending', 'failed')
     and (r.state, r.previous_parent, r.last_error) is distinct from (case when p_ok then 'linked' else 'failed' end, case when p_ok then p_previous_parent else r.previous_parent end, case when p_ok then null else left(coalesce(p_error, 'Jira refused it.'), 300) end);
end $$;
revoke all on function public.jira_record_epic_link(uuid, uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.jira_record_epic_link(uuid, uuid, text, boolean, text, text) to service_role;
