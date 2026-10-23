-- 0015: the leadership view (issue #29).
-- weekly_updates: the weekly update of a workspace, written from the data and edited by a creator or admin, then marked
--   reviewed. One per workspace, ISO week and scope. Everyone in the workspace reads it (leadership viewers read the
--   reviewed one); editing the text clears the review; Claude can write the draft but never mark it reviewed.
-- weekly_item_changes: rank, status and health changes of a workspace since a time, from the audit log, readable by every
--   member (the audit table itself is admin-only).
-- No DROP statements: applied to Supabase through a tool that pauses on them.
create table public.weekly_updates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  scope_key text not null default 'all' check (char_length(scope_key) between 1 and 80),
  scope_label text not null default 'All projects' check (char_length(scope_label) <= 120),
  body text not null check (char_length(body) between 1 and 20000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, week_start, scope_key)
);
create index weekly_updates_week_idx on public.weekly_updates (tenant_id, week_start desc);

create function public.weekly_updates_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    new.reviewed_at := null; new.reviewed_by := null; -- an edited text has not been reviewed
  elsif new.reviewed_at is distinct from old.reviewed_at then
    if new.reviewed_at is null then
      new.reviewed_by := null;
    else
      if public.write_source() = 'Claude MCP' then
        raise exception 'Claude cannot mark a weekly update as reviewed' using errcode = 'PV004';
      end if;
      new.reviewed_at := now(); new.reviewed_by := auth.uid(); -- who and when are set here, not by the browser
    end if;
  end if;
  return new;
end $$;
create trigger weekly_updates_guard before update on public.weekly_updates
  for each row execute function public.weekly_updates_guard();
create trigger weekly_updates_meta before insert or update on public.weekly_updates
  for each row execute function public.set_write_meta();
create trigger weekly_updates_audit after insert or update or delete on public.weekly_updates
  for each row execute function public.audit_row();

alter table public.weekly_updates enable row level security;
create policy weekly_updates_select on public.weekly_updates for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy weekly_updates_insert on public.weekly_updates for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy weekly_updates_update on public.weekly_updates for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.weekly_updates from public, anon, authenticated;
grant select on public.weekly_updates to authenticated;
grant insert (id, tenant_id, week_start, scope_key, scope_label, body) on public.weekly_updates to authenticated;
grant update (scope_label, body, reviewed_at) on public.weekly_updates to authenticated;

create function public.weekly_item_changes(p_tenant uuid, p_since timestamptz)
returns table (item_id uuid, field text, old jsonb, new jsonb, at timestamptz, actor_id uuid, via text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select a.entity_id, a.field, a.old, a.new, a.at, a.actor_id, a.via
    from public.audit_log a
    where a.tenant_id = p_tenant and a.entity = 'items' and a.field in ('stack_rank', 'status', 'health') and a.at >= p_since
    order by a.at, a.id
    limit 5000;
end $$;
revoke all on function public.weekly_item_changes(uuid, timestamptz) from public, anon;
grant execute on function public.weekly_item_changes(uuid, timestamptz) to authenticated;
