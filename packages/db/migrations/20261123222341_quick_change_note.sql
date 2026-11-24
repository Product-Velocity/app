-- Issue #635, phone quick actions: change an initiative's Health or Initiative Status from a phone with a short note, in one step.
-- The note is the reason for the change. It is kept on the audit row of the change (audit_log.basis, the column that already holds a person's own words for
-- Business Value Type), so it has an actor, a source and a time like every other change (CLAUDE.md rule 5). No new table.
--
-- item_quick_change(item, field, value, note): SECURITY INVOKER, so row-level security (editors of the workspace only) and the item guards apply exactly as they
--   do to a normal edit; only Health and Initiative Status can be changed this way. A note is required (a few words) when the value is a concern: Health At Risk,
--   Delayed or Blocked, Initiative Status On hold or Cancelled; otherwise it is optional. Initiative Phase is never changed here (it goes through a decision gate).
-- audit_log_change_note(): a trigger that copies the note of that one operation (the transaction-local setting pv.change_note) onto the audit rows of
--   Health and Initiative Status. The setting is cleared before the function returns and a transaction-local setting never outlives its transaction.
-- change_notes(tenant, ids): the notes of those audit rows, readable by every member of the workspace (the audit table itself is admin-only), for Health and
--   Initiative Status only, so no other basis (Business Value Type) can be read through it. Same membership check as change_feed.
-- Functions replaced by this migration: none. No DROP statements.

create function public.audit_log_change_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.entity = 'items' and new.field in ('health', 'initiative_status') and coalesce(current_setting('pv.change_note', true), '') <> '' then
    new.basis := left(current_setting('pv.change_note', true), 300);
  end if;
  return new;
end $$;
create trigger audit_log_change_note before insert on public.audit_log
  for each row execute function public.audit_log_change_note();

create function public.item_quick_change(p_item uuid, p_field text, p_value text, p_note text default null)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_concern boolean;
  v_old text;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_field not in ('health', 'initiative_status') then
    raise exception 'Only Health and Initiative Status can be changed this way.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    raise exception 'Choose a value.' using errcode = '22023';
  end if;
  v_concern := (p_field = 'health' and p_value in ('At Risk', 'Delayed', 'Blocked'))
            or (p_field = 'initiative_status' and p_value in ('On hold', 'Cancelled'));
  if v_concern and (v_note is null or char_length(v_note) < 4) then
    raise exception 'Say why in a few words.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note can be at most 300 characters.' using errcode = '22023';
  end if;

  -- row-level security decides what this person can see and change
  execute format('select %I from public.items where id = $1 and deleted_at is null', p_field) into v_old using p_item;
  get diagnostics v_rows = row_count; -- EXECUTE does not set FOUND
  if v_rows = 0 then
    raise exception 'That initiative is not available to you.' using errcode = '42501';
  end if;

  perform set_config('pv.change_note', coalesce(v_note, ''), true);
  execute format('update public.items set %I = $1 where id = $2 and deleted_at is null', p_field) using p_value, p_item;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    perform set_config('pv.change_note', '', true);
    raise exception 'You cannot change this initiative.' using errcode = '42501';
  end if;
  perform set_config('pv.change_note', '', true);
  return jsonb_build_object('field', p_field, 'old', v_old, 'new', p_value);
end $$;
revoke all on function public.item_quick_change(uuid, text, text, text) from public, anon;
grant execute on function public.item_quick_change(uuid, text, text, text) to authenticated;

create function public.change_notes(p_tenant uuid, p_ids bigint[])
returns table (id bigint, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Ask for at most 500 changes at a time.' using errcode = '22023';
  end if;
  return query
    select a.id, a.basis
      from public.audit_log a
     where a.tenant_id = p_tenant and a.id = any (p_ids)
       and a.entity = 'items' and a.field in ('health', 'initiative_status') and a.basis is not null;
end $$;
revoke all on function public.change_notes(uuid, bigint[]) from public, anon;
grant execute on function public.change_notes(uuid, bigint[]) to authenticated;
