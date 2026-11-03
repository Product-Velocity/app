-- Jira, the WRITE side of Sync (issue #67, #71): what Product Velocity needs to remember to compare and send safely.
-- item_jira_links gets sync_base (hashes only, no text: the agreed title and description at the last sync, the twin of item_github_links.sync_base),
--   sent_hash (a hash of the parts that are written but not compared: labels, due date, ...: an unchanged item sends nothing) and sync_checked_at.
-- Service-role functions (the app server calls them after the person confirmed; they check the actor is a creator or admin and not a service account):
--   jira_record_sync(actor, item, base, sent_hash)  after a successful send or a taken-over text;
--   jira_create_link(actor, item, connection, site, key, id, url)  after Sync created the issue of an initiative that had none;
--   jira_apply_pull(actor, item, fields, base)  Keep Jira: only the allowlisted columns initiative_name and description, audited as the person.
-- Status is never written by any of them (rule 6). Functions replaced by this migration: none. No DROP statements.

alter table public.item_jira_links
  add column sync_base jsonb check (sync_base is null or jsonb_typeof(sync_base) = 'object'),
  add column sent_hash text check (sent_hash is null or sent_hash ~ '^[0-9a-f]{64}$'),
  add column sync_checked_at timestamptz;

create function public.jira_sync_actor_ok(p_actor uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  )
$$;
revoke all on function public.jira_sync_actor_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.jira_sync_actor_ok(uuid, uuid) to service_role;

create function public.jira_record_sync(p_actor uuid, p_item uuid, p_base jsonb, p_sent_hash text default null)
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
  if p_base is null or jsonb_typeof(p_base) <> 'object' then raise exception 'bad base' using errcode = '22023'; end if;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_jira_links l
     set sync_base = coalesce(l.sync_base, '{}'::jsonb) || p_base,
         sent_hash = coalesce(p_sent_hash, l.sent_hash),
         sync_checked_at = now()
   where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push';
  if not found then raise exception 'This item has no Jira link that can be synced.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.jira_record_sync(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.jira_record_sync(uuid, uuid, jsonb, text) to service_role;

-- A new link for an initiative whose issue Sync just created. The initiative must belong to a project that is linked to the same Jira project.
create function public.jira_create_link(p_actor uuid, p_item uuid, p_connection uuid, p_site text, p_key text, p_issue_id text, p_url text, p_base jsonb, p_sent_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_project uuid;
begin
  select tenant_id, home_project_id into v_tenant, v_project from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can sync an item with Jira.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.jira_project_links pl
    where pl.tenant_id = v_tenant and pl.project_id = v_project and pl.connection_id = p_connection and pl.site_id = p_site
      and p_key like pl.jira_project_key || '-%'
  ) then
    raise exception 'That Jira issue does not belong to this initiative''s Jira project.' using errcode = 'PV008';
  end if;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, sync_base, sent_hash, sync_checked_at, created_by, created_via)
  values (v_tenant, p_item, p_connection, p_site, p_key, p_issue_id, p_url, 'push', p_base, p_sent_hash, now(), p_actor, 'UI');
end $$;
revoke all on function public.jira_create_link(uuid, uuid, uuid, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.jira_create_link(uuid, uuid, uuid, text, text, text, text, jsonb, text) to service_role;

-- Keep Jira: take over the title or the description of the issue. Nothing else can be taken over (no commercial field, no status).
create function public.jira_apply_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  k text;
  v_old public.items%rowtype;
  v_changed jsonb := '{}'::jsonb;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.jira_sync_actor_ok(p_actor, v_tenant) then
    raise exception 'Only a creator or admin can take over text from Jira.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_jira_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push') then
    raise exception 'This item has no Jira issue that can be synced.' using errcode = 'P0002';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'bad fields' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('initiative_name', 'description') then
      raise exception 'The field % cannot be taken over from Jira.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  if p_fields ? 'initiative_name' and char_length(btrim(p_fields ->> 'initiative_name')) = 0 then
    raise exception 'An initiative needs a name.' using errcode = '22023';
  end if;
  select * into v_old from public.items where id = p_item for update;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set
    initiative_name = case when p_fields ? 'initiative_name' then left(btrim(p_fields ->> 'initiative_name'), 300) else initiative_name end,
    description = case when p_fields ? 'description' then nullif(left(p_fields ->> 'description', 20000), '') else description end
  where id = p_item;
  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k when 'initiative_name' then v_old.initiative_name else v_old.description end);
  end loop;
  if p_base is not null then
    update public.item_jira_links l set sync_base = coalesce(l.sync_base, '{}'::jsonb) || p_base, sync_checked_at = now()
     where l.tenant_id = v_tenant and l.item_id = p_item;
  end if;
  return v_changed; -- the values that were replaced, for the undo step
end $$;
revoke all on function public.jira_apply_pull(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.jira_apply_pull(uuid, uuid, jsonb, jsonb) to service_role;
