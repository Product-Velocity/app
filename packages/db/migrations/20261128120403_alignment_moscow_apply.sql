-- Issue #746, slice 2: an admin sets the MoSCoW field from the vote of a closed MoSCoW session, as one audited change that can be undone.
-- New table alignment_moscow_applications: one row per application (session, who and when through the usual created_by / created_at / created_via,
--   the changes {item, from, to, suggested, reason} so an undo can restore the values exactly, and when it was undone). **Admins only** read it (a
--   reason can hold commercial context, like alignment_rank_reasons); nobody writes it directly: only the two functions below do.
-- alignment_moscow_apply(session, changes, scope): an admin, never Claude or a service account (PV004). The session must be a MoSCoW session, closed
--   or archived, with stored results. Each initiative must be in the session and live, and still have the MoSCoW the person saw (`from`), otherwise
--   PV025: it changed since the preview and the person is asked again. The suggestion is worked out here from the stored vote, never taken from the
--   caller: wherever the final value (`to`) differs from it, a reason of 1 to 300 characters is needed (PV026), also for a value the person chose on
--   purpose. Writes only items.moscow (the items audit trigger records actor, source, old and new per initiative) and adds one entry on the session.
-- alignment_moscow_undo(application): restores the earlier values exactly, only if every initiative still has the value the application set
--   (otherwise PV025: undoing would overwrite a later change), and only once.
-- New objects only: no replaced function, no DROP.
create table public.alignment_moscow_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  scope text not null check (scope in ('all', 'selection')),
  changes jsonb not null check (jsonb_typeof(changes) = 'array'),
  changed integer not null check (changed >= 1),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade
);
create index alignment_moscow_applications_session on public.alignment_moscow_applications (tenant_id, session_id, created_at desc);
create trigger alignment_moscow_applications_meta before insert or update on public.alignment_moscow_applications
  for each row execute function public.set_write_meta();
create trigger alignment_moscow_applications_audit after insert or update on public.alignment_moscow_applications
  for each row execute function public.audit_row();
-- platform staff read, never write, customer data (rule 10)
create trigger a_platform_readonly_guard before insert or update or delete on public.alignment_moscow_applications
  for each row execute function platform.readonly_guard();
-- a paused account can write nothing (the guard every tenant table carries)
create trigger b_platform_suspended_guard before insert or update or delete on public.alignment_moscow_applications
  for each row execute function platform.suspended_guard();
alter table public.alignment_moscow_applications enable row level security;
create policy alignment_moscow_applications_select on public.alignment_moscow_applications for select to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));
revoke all on public.alignment_moscow_applications from public, anon, authenticated;
grant select on public.alignment_moscow_applications to authenticated;
grant all on public.alignment_moscow_applications to service_role;

create function public.alignment_moscow_apply(p_session uuid, p_changes jsonb, p_scope text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  r record;
  v_n integer; v_items integer; v_bad boolean;
  v_stored jsonb := '[]'::jsonb;
  v_sug text; v_reason text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.write_source() = 'MCP' or exists (
    select 1 from public.tenant_members m where m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot set the MoSCoW from a vote; a person does' using errcode = 'PV004';
  end if;
  select * into s from public.alignment_sessions where id = p_session;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot apply the result of this session.' using errcode = '42501';
  end if;
  if s.method <> 'moscow' then raise exception 'This session did not vote on MoSCoW.' using errcode = '22023'; end if;
  if s.status not in ('closed', 'archived') or s.results_snapshot is null then
    raise exception 'The session has no final results yet.' using errcode = '22023';
  end if;
  if p_scope not in ('all', 'selection') then raise exception 'Bad scope.' using errcode = '22023'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 100 then
    raise exception 'Choose between 1 and 100 initiatives.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);

  select count(*), count(distinct c.item),
         bool_or(c.item is null or c."to" is null or c."to" not in ('Must', 'Should', 'Could', 'Won''t') or (c."from" is not null and c."from" not in ('Must', 'Should', 'Could', 'Won''t')))
    into v_n, v_items, v_bad
    from jsonb_to_recordset(p_changes) as c(item uuid, "from" text, "to" text, reason text);
  if v_bad then raise exception 'Bad values.' using errcode = '22023'; end if;
  if v_n <> v_items then raise exception 'An initiative is listed twice.' using errcode = '22023'; end if;
  -- every initiative is in this session and live
  if exists (
    select 1 from jsonb_to_recordset(p_changes) as c(item uuid, "from" text, "to" text, reason text)
     where not exists (select 1 from public.alignment_items ai where ai.session_id = p_session and ai.tenant_id = s.tenant_id and ai.item_id = c.item)
        or not exists (select 1 from public.items i where i.id = c.item and i.tenant_id = s.tenant_id and i.deleted_at is null)
  ) then
    raise exception 'Some initiatives are not part of this session or are in the Trash.' using errcode = '22023';
  end if;
  -- the value is still what the person saw
  if exists (select 1 from jsonb_to_recordset(p_changes) as c(item uuid, "from" text, "to" text, reason text) join public.items i on i.id = c.item where i.moscow is distinct from c."from") then
    raise exception 'A MoSCoW changed since you looked at it. Open the suggestion again.' using errcode = 'PV025';
  end if;

  for r in select c.item, c."from", c."to", c.reason from jsonb_to_recordset(p_changes) as c(item uuid, "from" text, "to" text, reason text) loop
    continue when r."from" is not distinct from r."to";
    -- the vote's own suggestion, from the stored result (never from the caller)
    select case m.elem ->> 'suggested' when 'must' then 'Must' when 'should' then 'Should' when 'could' then 'Could' when 'wont' then 'Won''t' end
      into v_sug
      from public.alignment_items ai
      cross join lateral jsonb_array_elements(coalesce(s.results_snapshot -> 'results' -> 'moscow', '[]'::jsonb)) as m(elem)
     where ai.session_id = p_session and ai.item_id = r.item and m.elem ->> 'itemId' = ai.id::text;
    if v_sug is null then raise exception 'The vote has no result for this initiative.' using errcode = '22023'; end if;
    v_reason := nullif(btrim(regexp_replace(coalesce(r.reason, ''), '\s+', ' ', 'g')), '');
    if r."to" <> v_sug and (v_reason is null or char_length(v_reason) > 300) then
      raise exception 'Give a reason (1 to 300 characters) for every initiative whose value differs from the vote.' using errcode = 'PV026';
    end if;
    update public.items set moscow = r."to" where id = r.item;
    v_stored := v_stored || jsonb_build_object('item', r.item, 'from', r."from", 'to', r."to", 'suggested', v_sug, 'reason', case when r."to" <> v_sug then v_reason end);
  end loop;
  if jsonb_array_length(v_stored) = 0 then raise exception 'These initiatives already have those values.' using errcode = '22023'; end if;

  insert into public.alignment_moscow_applications (tenant_id, session_id, scope, changes, changed)
    values (s.tenant_id, p_session, p_scope, v_stored, jsonb_array_length(v_stored)) returning id into v_id;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (s.tenant_id, 'alignment_sessions', s.id, 'moscow_applied', null, jsonb_build_object('application', v_id, 'changed', jsonb_array_length(v_stored), 'scope', p_scope, 'session', s.name), auth.uid(), public.write_source());
  return v_id;
end $$;
revoke all on function public.alignment_moscow_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.alignment_moscow_apply(uuid, jsonb, text) to authenticated;

create function public.alignment_moscow_undo(p_application uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.alignment_moscow_applications%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.write_source() = 'MCP' or exists (
    select 1 from public.tenant_members m where m.user_id = auth.uid() and m.is_service_account
  ) then
    raise exception 'Claude and service accounts cannot undo this; a person does' using errcode = 'PV004';
  end if;
  select * into a from public.alignment_moscow_applications where id = p_application for update;
  if not found or a.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot undo this.' using errcode = '42501';
  end if;
  if a.undone_at is not null then raise exception 'This was already undone.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  -- every initiative must still have the value the application set, or the undo would overwrite a later change
  if exists (
    select 1 from jsonb_to_recordset(a.changes) as m(item uuid, "from" text, "to" text)
     where not exists (select 1 from public.items i where i.id = m.item and i.deleted_at is null and i.moscow is not distinct from m."to")
  ) then
    raise exception 'A MoSCoW changed after this was applied, so it cannot be undone without overwriting that change.' using errcode = 'PV025';
  end if;
  update public.items i set moscow = m."from"
    from jsonb_to_recordset(a.changes) as m(item uuid, "from" text, "to" text) where i.id = m.item;
  update public.alignment_moscow_applications set undone_at = now(), undone_by = auth.uid() where id = a.id;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (a.tenant_id, 'alignment_sessions', a.session_id, 'moscow_apply_undone', jsonb_build_object('application', a.id), jsonb_build_object('changed', a.changed), auth.uid(), public.write_source());
end $$;
revoke all on function public.alignment_moscow_undo(uuid) from public, anon;
grant execute on function public.alignment_moscow_undo(uuid) to authenticated;
