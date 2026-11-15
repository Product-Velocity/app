-- jira_check_runs: the saved results of the Jira connection checks (issue #452, parent #431), so an admin does not copy results into chat and
-- Claude can read them. One row per run of the Test connection page: kind 'read' (Initiative-level checks, reads only) or 'write' (creates and
-- deletes 2 test issues). `checks` is a JSON array of { key, label, status pass|warn|fail, reason }: counts, type names, project keys and
-- reasons only. NEVER issue text, people, emails, site addresses or tokens (the app sanitises every reason; the table caps size and shape).
-- Written only through jira_check_run_save() by a HUMAN admin of the workspace (never Claude, a service account or platform staff); admins read.
-- Audited by audit_row (actor = the admin, source 'UI', the new value). Functions replaced by this migration: none (one new function).
-- No DROP statements. Fast RLS pattern with an index starting with tenant_id (spike S7).

create table public.jira_check_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  run_at timestamptz not null default now(),
  run_by uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('read', 'write')),
  checks jsonb not null check (jsonb_typeof(checks) = 'array' and jsonb_array_length(checks) between 1 and 40 and pg_column_size(checks) <= 20000),
  foreign key (tenant_id, connection_id) references public.jira_connections (tenant_id, id) on delete cascade
);
create index jira_check_runs_tenant_idx on public.jira_check_runs (tenant_id, connection_id, kind, run_at desc);

create trigger a_platform_readonly_guard before insert or update or delete on public.jira_check_runs
  for each row execute function platform.readonly_guard();
create trigger jira_check_runs_audit after insert or update or delete on public.jira_check_runs
  for each row execute function public.audit_row();

alter table public.jira_check_runs enable row level security;
create policy jira_check_runs_select on public.jira_check_runs for select to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.jira_check_runs from public, anon, authenticated;
grant select on public.jira_check_runs to authenticated;
grant all on public.jira_check_runs to service_role;

create function public.jira_check_run_save(p_tenant uuid, p_connection uuid, p_kind text, p_checks jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_tenant is null or not (p_tenant = any (array (select public.my_human_admin_tenant_ids()))) then
    raise exception 'only a human admin of the workspace can save Jira check results' using errcode = '42501';
  end if;
  perform set_config('app.via', 'UI', true);
  insert into public.jira_check_runs (tenant_id, connection_id, run_by, kind, checks)
  values (p_tenant, p_connection, auth.uid(), p_kind, p_checks)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.jira_check_run_save(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.jira_check_run_save(uuid, uuid, text, jsonb) to authenticated;
