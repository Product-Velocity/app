-- Issue #512 (decision 2026-11-18-jira-initiative-fields): Health, Initiative Status and Initiative Phase mapped to custom single-select fields of the Jira
-- issue that is the initiative, per Jira-linked project.
--
-- jira_select_map: one row per mapped slot (jira.select.health, jira.select.initiative_status, jira.select.initiative_phase): the Jira custom field id, the
--   direction (to_jira, or two_way for Health and Initiative Status only: Initiative Phase never comes from Jira, a move past a decision gate is the
--   database's to refuse, PV006) and the Jira option id that stands for each Product Velocity value. Written only by jira_set_select_map (a human workspace
--   admin; never Claude (MCP), a service account or platform staff), audited by the table's audit trigger. Nothing is written to Jira by it.
-- jira_apply_select_pull(actor, item, fields, base): a person accepted a change that came back from Jira. Takes health and initiative_status only (never
--   initiative_phase, never Build Status), audited as the person, source UI. The values are checked by the check constraints of items. The sync base
--   (item_jira_links.sync_base, a free-form object) gets the agreed values.
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_select_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  slot text not null check (slot in ('jira.select.health', 'jira.select.initiative_status', 'jira.select.initiative_phase')),
  field_id text not null check (field_id ~ '^customfield_[0-9]{1,9}$'),
  direction text not null check (direction in ('to_jira', 'two_way')),
  options jsonb not null check (jsonb_typeof(options) = 'object'),
  check (slot <> 'jira.select.initiative_phase' or direction = 'to_jira'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  unique (project_id, slot),
  foreign key (tenant_id, project_id) references public.projects (tenant_id, id) on delete cascade
);
create index jira_select_map_tenant_idx on public.jira_select_map (tenant_id, project_id);

create trigger jira_select_map_meta before insert or update on public.jira_select_map
  for each row execute function public.set_write_meta();
create trigger jira_select_map_audit after insert or update or delete on public.jira_select_map
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_select_map
  for each row execute function platform.readonly_guard();

alter table public.jira_select_map enable row level security;
create policy jira_select_map_select on public.jira_select_map for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_select_map from public, anon, authenticated;
grant select on public.jira_select_map to authenticated;
grant all on public.jira_select_map to service_role;

-- Replaces the project's mapping with the given list (an empty list removes it). Rows: {slot, field, direction, options: {<value>: "<option id>"}}.
create function public.jira_set_select_map(p_project uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tracker text;
  r jsonb;
  v_slot text;
  v_field text;
  v_dir text;
  v_slots text[] := '{}';
  v_fields text[] := '{}';
  v_ids text[];
  kv record;
begin
  select tenant_id, tracker into v_tenant, v_tracker from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change the field configuration.' using errcode = '42501';
  end if;
  if v_tracker is distinct from 'jira' then raise exception 'That project has no Jira tracker.' using errcode = 'P0002'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad configuration' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'slot') is distinct from 'string' or jsonb_typeof(r -> 'field') is distinct from 'string'
       or jsonb_typeof(r -> 'direction') is distinct from 'string' or jsonb_typeof(r -> 'options') is distinct from 'object' then
      raise exception 'bad configuration row' using errcode = '22023';
    end if;
    v_slot := r ->> 'slot'; v_field := r ->> 'field'; v_dir := r ->> 'direction';
    if v_slot not in ('jira.select.health', 'jira.select.initiative_status', 'jira.select.initiative_phase') then
      raise exception 'The setting % can not be changed.', v_slot using errcode = '22023';
    end if;
    if v_slot = any (v_slots) then raise exception 'The setting % appears twice.', v_slot using errcode = '22023'; end if;
    if v_field !~ '^customfield_[0-9]{1,9}$' then raise exception 'The setting % can not name the field %.', v_slot, v_field using errcode = '22023'; end if;
    if v_field = any (v_fields) then raise exception 'The Jira field % is already used by another setting.', v_field using errcode = '22023'; end if;
    if v_dir not in ('to_jira', 'two_way') then raise exception 'bad direction' using errcode = '22023'; end if;
    if v_slot = 'jira.select.initiative_phase' and v_dir <> 'to_jira' then
      raise exception 'Initiative Phase only goes from Product Velocity to Jira.' using errcode = '22023';
    end if;
    v_ids := '{}';
    for kv in select key, value from jsonb_each(r -> 'options') loop
      if kv.key !~ '^[A-Za-z0-9 -]{1,30}$' or jsonb_typeof(kv.value) <> 'string' or (kv.value #>> '{}') !~ '^[0-9]{1,12}$' then
        raise exception 'bad option for %', v_slot using errcode = '22023';
      end if;
      if v_dir = 'two_way' and (kv.value #>> '{}') = any (v_ids) then
        raise exception 'Two values of % use the same Jira option, so the way back would be ambiguous.', v_slot using errcode = '22023';
      end if;
      v_ids := v_ids || (kv.value #>> '{}');
    end loop;
    v_slots := v_slots || v_slot;
    v_fields := v_fields || v_field;
    perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
    insert into public.jira_select_map (tenant_id, project_id, slot, field_id, direction, options)
      values (v_tenant, p_project, v_slot, v_field, v_dir, r -> 'options')
      on conflict (project_id, slot) do update set field_id = excluded.field_id, direction = excluded.direction, options = excluded.options
        where (public.jira_select_map.field_id, public.jira_select_map.direction, public.jira_select_map.options) is distinct from (excluded.field_id, excluded.direction, excluded.options);
  end loop;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  delete from public.jira_select_map where project_id = p_project and tenant_id = v_tenant and not (slot = any (v_slots));
end $$;
revoke all on function public.jira_set_select_map(uuid, jsonb) from public, anon;
grant execute on function public.jira_set_select_map(uuid, jsonb) to authenticated;

-- A person accepted a change that came back from Jira (Health or Initiative Status). Returns the old values.
create function public.jira_apply_select_pull(p_actor uuid, p_item uuid, p_fields jsonb, p_base jsonb)
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
    raise exception 'Only a creator or admin can take over a value from Jira.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_jira_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push') then
    raise exception 'This item has no Jira issue that can be synced.' using errcode = 'P0002';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'bad fields' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('health', 'initiative_status') then
      raise exception 'The field % cannot be taken over from Jira.', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_fields -> k) <> 'string' then raise exception 'bad value for %', k using errcode = '22023'; end if;
  end loop;
  select * into v_old from public.items where id = p_item for update;
  perform set_config('app.via', 'UI', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who accepted
  update public.items set
    health = case when p_fields ? 'health' then p_fields ->> 'health' else health end,
    initiative_status = case when p_fields ? 'initiative_status' then p_fields ->> 'initiative_status' else initiative_status end
  where id = p_item;
  for k in select jsonb_object_keys(p_fields) loop
    v_changed := v_changed || jsonb_build_object(k, case k when 'health' then v_old.health else v_old.initiative_status end);
  end loop;
  if p_base is not null then
    update public.item_jira_links l set sync_base = coalesce(l.sync_base, '{}'::jsonb) || p_base, sync_checked_at = now()
     where l.tenant_id = v_tenant and l.item_id = p_item;
  end if;
  return v_changed;
end $$;
revoke all on function public.jira_apply_select_pull(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.jira_apply_select_pull(uuid, uuid, jsonb, jsonb) to service_role;
