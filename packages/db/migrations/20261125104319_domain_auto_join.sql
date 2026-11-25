-- Domain auto-join (issue #673, Ashu 2026-11-25): a confirmed or verified email at an authorized domain joins the workspace as an active
-- Viewer, and the admins are told (the app sends the email). A per-workspace switch, default ON; off keeps the Requested Access flow of 0049/0052.
-- Only people with no row yet are touched: paused, revoked and already requested people are never changed by signing up again.

alter table public.tenants add column auto_join_authorized_domains boolean not null default true;
grant update (auto_join_authorized_domains) on public.tenants to authenticated;

-- The return types gain `joined` (true when this call made the person an active Viewer), so the functions are dropped and recreated.
drop function public.request_access_by_domain();
create function public.request_access_by_domain()
returns table (tenant_id uuid, tenant_name text, created boolean, joined boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text;
  t record;
  v_new boolean;
  v_primary text;
  v_seen uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select lower(u.email) into v_primary from auth.users u where u.id = auth.uid();
  perform set_config('app.via', 'system', true);
  for v_email in select x from identity.verified_emails(auth.uid()) x where position('@' in x) > 0 order by (x = v_primary) desc, x loop
    for t in select x.id, x.name, x.auto_join_authorized_domains as auto from public.tenants x where x.allowed_email_domains @> array[split_part(v_email, '@', 2)] order by x.created_at loop
      insert into public.tenant_members (tenant_id, user_id, role, status, requested_via_email)
      values (t.id, auth.uid(), 'viewer', case when t.auto then 'active' else 'requested' end, case when v_email = v_primary then null else v_email end)
      on conflict (tenant_id, user_id) do nothing;
      get diagnostics v_new = row_count;
      if v_new or exists (select 1 from public.tenant_members m where m.tenant_id = t.id and m.user_id = auth.uid() and m.status = 'requested') then
        -- one row per workspace even when several of the person's addresses match it
        if not (t.id = any (v_seen)) then
          v_seen := v_seen || t.id;
          request_access_by_domain.tenant_id := t.id; request_access_by_domain.tenant_name := t.name;
          request_access_by_domain.created := v_new; request_access_by_domain.joined := v_new and t.auto;
          return next;
        end if;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.request_access_by_domain() from public, anon;
grant execute on function public.request_access_by_domain() to authenticated;

drop function public.link_email_verify(text, text);
create function public.link_email_verify(p_email text, p_code text)
returns table (ok boolean, tenant_id uuid, tenant_name text, created boolean, joined boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row identity.emails;
  v_new boolean;
  v_any boolean := false;
  t record;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_row from identity.emails where user_id = auth.uid() and email = v_email for update;
  if not found or v_row.verified_at is not null or v_row.code_hash is null
     or v_row.code_expires_at < now() or v_row.code_attempts >= 5 then
    return query select false, null::uuid, null::text, false, false;
    return;
  end if;
  if v_row.code_hash <> encode(sha256(convert_to(coalesce(btrim(p_code), ''), 'utf8')), 'hex')
     or exists (select 1 from identity.emails e where e.email = v_email and e.verified_at is not null) then
    update identity.emails set code_attempts = code_attempts + 1 where id = v_row.id;
    return query select false, null::uuid, null::text, false, false;
    return;
  end if;
  update identity.emails set verified_at = now(), code_hash = null, code_expires_at = null, code_attempts = 0 where id = v_row.id;
  perform set_config('app.via', 'system', true);
  for t in select x.id, x.name, x.auto_join_authorized_domains as auto from public.tenants x where x.allowed_email_domains @> array[split_part(v_email, '@', 2)] order by x.created_at loop
    insert into public.tenant_members (tenant_id, user_id, role, status, requested_via_email)
    values (t.id, auth.uid(), 'viewer', case when t.auto then 'active' else 'requested' end, v_email)
    on conflict (tenant_id, user_id) do nothing;
    get diagnostics v_new = row_count;
    if v_new then
      v_any := true;
      return query select true, t.id, t.name, true, t.auto;
    end if;
  end loop;
  if not v_any then
    return query select true, null::uuid, null::text, false, false;
  end if;
end $$;
revoke all on function public.link_email_verify(text, text) from public, anon;
grant execute on function public.link_email_verify(text, text) to authenticated;
