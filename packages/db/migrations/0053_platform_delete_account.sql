-- 0053: a platform admin can delete a customer account (issue #219 follow-up, R-111).
-- Hard delete, on purpose and with a typed confirmation: the account's rows go with it (every tenant table cascades from tenants).
-- What stays: audit_log rows (no foreign key by design, history outlives the tenant) and a platform.config_log entry that says who
-- deleted which account, when, and how big it was. Files in storage and the GitHub App installation are NOT touched here.
create function public.platform_delete_account(p_tenant uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; v_members integer; v_projects integer; v_items integer;
begin
  perform platform.require_admin();
  select * into t from public.tenants where id = p_tenant;
  if not found then raise exception 'unknown account' using errcode = 'P0002'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> t.name then
    raise exception 'type the exact account name to confirm' using errcode = 'PV024';
  end if;
  select count(*) into v_members from public.tenant_members where tenant_id = p_tenant;
  select count(*) into v_projects from public.projects where tenant_id = p_tenant;
  select count(*) into v_items from public.items where tenant_id = p_tenant;
  -- close open entries first, so the read-only guard cannot stand in the way of the cascade
  update platform.entries set left_at = now() where tenant_id = p_tenant and left_at is null;
  perform platform.log_config('account_deleted', null, p_tenant, jsonb_build_object('name', t.name, 'members', v_members, 'projects', v_projects, 'initiatives', v_items), null);
  delete from public.tenants where id = p_tenant;
end $$;
revoke all on function public.platform_delete_account(uuid, text) from public, anon;
grant execute on function public.platform_delete_account(uuid, text) to authenticated;
