-- Rename and delete a Product Velocity project (Ashu, 2026-11-18: "rename and delete a PV project; confirm to delete the initiatives and all data, then delete;
-- follow the deletion process"). Issue #526.
--
-- project_rename(project, name): a human workspace admin only (never Claude, a service account, a creator or another workspace). The name is trimmed, 1 to 120
--   characters, and unique in the workspace (the existing unique index, case and spaces ignored). Audited by the table's audit trigger (old and new name).
-- project_delete(project, confirm_name): a human workspace admin only. The typed name must match the project's name. In ONE transaction, following the
--   deletion process of initiatives (0017_items_soft_delete.sql): 1. the live initiatives go to the Trash with delete_items(); 2. every initiative of the
--   project (those just trashed and any already in the Trash) is deleted for good with purge_items() (admin only, only from the Trash, minimal audit);
--   3. the project row is deleted, and with it by cascade its saved-scope membership, Jira link and read issue list, field configuration, select mappings
--   and the rest of what is keyed by the project. The only table that does NOT cascade is items (home_project_id), which is why the initiatives go first.
--   Any refusal (a purge that fails, a row that still points to the project) raises and rolls the whole transaction back: nothing is half deleted.
--   Returns {initiatives, purged, files}: the storage paths of the files attached to those initiatives, so the app can remove the bytes afterwards (the
--   database cannot reach storage). Jira and GitHub are never written: their issues stay as they are.
-- Functions replaced by this migration: none. No DROP statements.

create function public.project_rename(p_project uuid, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_old text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select tenant_id, name into v_tenant, v_old from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can rename a project.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Give the project a name of 1 to 120 characters.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  begin
    update public.projects set name = v_name where id = p_project;
  exception when unique_violation then
    raise exception 'A project with that name already exists.' using errcode = '23505';
  end;
  return v_old;
end $$;
revoke all on function public.project_rename(uuid, text) from public, anon;
grant execute on function public.project_rename(uuid, text) to authenticated;

create function public.project_delete(p_project uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_name text;
  v_all uuid[];
  v_live uuid[];
  v_files text[];
  v_trashed integer := 0;
  v_purged integer := 0;
  r record;
begin
  select tenant_id, name into v_tenant, v_name from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can delete a project.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_name)) then
    raise exception 'The name you typed does not match the project.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  select coalesce(array_agg(i.id), '{}'), coalesce(array_agg(i.id) filter (where i.deleted_at is null), '{}')
    into v_all, v_live from public.items i where i.tenant_id = v_tenant and i.home_project_id = p_project;
  select coalesce(array_agg(a.storage_path), '{}') into v_files
    from public.item_attachments a where a.item_id = any (v_all) and a.storage_path is not null;

  -- 1. the deletion process: the live initiatives go to the Trash ...
  if coalesce(array_length(v_live, 1), 0) > 0 then
    for r in select * from public.delete_items(v_live) loop
      if r.ok then v_trashed := v_trashed + 1;
      else raise exception 'Could not delete an initiative: %', coalesce(r.reason, 'unknown reason') using errcode = 'PV011';
      end if;
    end loop;
  end if;
  -- 2. ... and everything of the project in the Trash is deleted for good
  if coalesce(array_length(v_all, 1), 0) > 0 then
    for r in select * from public.purge_items(v_all) loop
      if r.ok then v_purged := v_purged + 1;
      else raise exception 'Could not delete an initiative for good: %', coalesce(r.reason, 'unknown reason') using errcode = 'PV011';
      end if;
    end loop;
  end if;
  -- 3. the project and what is keyed by it
  delete from public.projects where id = p_project;
  return jsonb_build_object('initiatives', coalesce(array_length(v_all, 1), 0), 'purged', v_purged, 'files', to_jsonb(v_files));
end $$;
revoke all on function public.project_delete(uuid, text) from public, anon;
grant execute on function public.project_delete(uuid, text) to authenticated;
