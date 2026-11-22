-- Needs attention grid: snooze or dismiss one reason of one initiative (workspace-wide, so everyone sees the same list).
-- A snooze hides a reason until a date; a dismissal (snoozed_until is null) hides it until someone brings it back. It only changes what the
-- Needs attention list shows: it never moves a phase, a gate or any item value (CLAUDE.md rules 3 and 6). Audited like every write (rule 5).
-- New table only: no existing table or function is changed.

create table public.attention_snoozes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  kind text not null check (kind in (
    'delivery-risk', 'build-done', 'tracker-early', 'cancelled-building', 'hold-due', 'gate-waiting', 'conditions', 'stalled',
    'closed-open-work', 'phase-ahead', 'stale-issues', 'no-health')),
  snoozed_until date,
  note text check (note is null or char_length(btrim(note)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  unique (tenant_id, item_id, kind)
);
create index attention_snoozes_tenant_idx on public.attention_snoozes (tenant_id, item_id);

create trigger attention_snoozes_meta before insert or update on public.attention_snoozes
  for each row execute function public.set_write_meta();
create trigger attention_snoozes_audit after insert or update or delete on public.attention_snoozes
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.attention_snoozes
  for each row execute function platform.readonly_guard();

-- RLS (fast policy pattern, spike S7): everyone in the workspace reads; Creators and above change.
alter table public.attention_snoozes enable row level security;
create policy attention_snoozes_select on public.attention_snoozes for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy attention_snoozes_insert on public.attention_snoozes for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy attention_snoozes_update on public.attention_snoozes for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy attention_snoozes_delete on public.attention_snoozes for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.attention_snoozes from public, anon, authenticated;
grant select on public.attention_snoozes to authenticated;
grant insert (tenant_id, item_id, kind, snoozed_until, note) on public.attention_snoozes to authenticated;
grant update (snoozed_until, note) on public.attention_snoozes to authenticated;
grant delete on public.attention_snoozes to authenticated;

-- Snooze (or dismiss, when p_until is null) one reason on several initiatives in one call; asking again changes the date and note. Runs as the caller:
-- the insert and update policies above decide who may, and the audit trigger records them. Initiatives of another workspace are never matched.
create function public.snooze_attention(p_tenant uuid, p_items uuid[], p_kind text, p_until date, p_note text default null) returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_n integer;
begin
  insert into public.attention_snoozes (tenant_id, item_id, kind, snoozed_until, note)
  select i.tenant_id, i.id, p_kind, p_until, nullif(btrim(p_note), '')
    from public.items i where i.tenant_id = p_tenant and i.id = any (p_items)
  on conflict (tenant_id, item_id, kind) do update set snoozed_until = excluded.snoozed_until, note = excluded.note;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.snooze_attention(uuid, uuid[], text, date, text) from public, anon;
grant execute on function public.snooze_attention(uuid, uuid[], text, date, text) to authenticated;
