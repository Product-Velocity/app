-- 20261119163404_outcome_reviews_claude: Claude may record the 30, 60 and 90 day metrics a person stated (Ashu, chat 2026-11-19; docs/decisions/2026-11-19-outcome-reviews-claude-and-columns.md).
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- outcome_reviews gets one column, stated_words: the person's own words that gave the numbers (what Claude was told), kept with the row like the words behind a Business Value
--   Type. It is empty for a review a person typed in the app.
-- record_outcome_review_as_claude(item, at_days, value, adoption, note, words): only through the Claude connection (write_source() = 'MCP'; the app's own function refuses Claude, PV004),
--   as the signed-in person's role (an active Creator or Admin of the workspace, never a service account). The words are required (PV005). It never overwrites a checkpoint that is already
--   recorded: a person edits that in the app (PV006). It never requests metrics (that sends a notification, a person does it). Audited like every write, with the AI name and model.
-- Replaces the whole function public.record_outcome_review (created in 20261119140716_outcome_reviews, this family only, no open branch changes it) for one reason: when a person
--   saves a checkpoint in the app, the words Claude was given are cleared (they no longer describe the numbers). The body is otherwise the same.

alter table public.outcome_reviews
  add column stated_words text check (stated_words is null or char_length(stated_words) <= 2000);

create function public.record_outcome_review_as_claude(p_item uuid, p_at_days integer, p_value numeric, p_adoption numeric, p_note text, p_words text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_id uuid;
  v_prev timestamptz;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_words text := nullif(btrim(coalesce(p_words, '')), '');
begin
  if public.write_source() is distinct from 'MCP' then
    raise exception 'This is the Claude route; a person records metrics in the app' using errcode = 'PV004';
  end if;
  if p_at_days not in (30, 60, 90) then raise exception 'The review is at 30, 60 or 90 days' using errcode = 'PV005'; end if;
  select i.id, i.tenant_id, i.start_rollout, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  if not exists (select 1 from public.tenant_members m
                  where m.tenant_id = it.tenant_id and m.user_id = auth.uid() and m.status = 'active' and not m.is_service_account and m.role in ('creator', 'admin')) then
    raise exception 'Only a Creator or an Admin can record metrics' using errcode = '42501';
  end if;
  if it.start_rollout is null then raise exception 'This initiative has no Start Roll-Out date yet, so the review has no due date' using errcode = 'PV005'; end if;
  if v_words is null then raise exception 'Give the words the person used when they stated the numbers' using errcode = 'PV005'; end if;
  if char_length(v_words) > 2000 then raise exception 'The words are at most 2000 characters' using errcode = 'PV005'; end if;
  if p_value is null and p_adoption is null and v_note is null then raise exception 'Give at least a value, an adoption %% or a note' using errcode = 'PV005'; end if;
  if p_adoption is not null and (p_adoption < 0 or p_adoption > 100) then raise exception 'Adoption is a percentage from 0 to 100' using errcode = 'PV005'; end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'The note is at most 2000 characters' using errcode = 'PV005'; end if;
  select r.recorded_at into v_prev from public.outcome_reviews r where r.tenant_id = it.tenant_id and r.item_id = p_item and r.at_days = p_at_days;
  if v_prev is not null then
    raise exception 'The % day review is already recorded; a person changes it in the app', p_at_days::text using errcode = 'PV006';
  end if;
  insert into public.outcome_reviews (tenant_id, item_id, at_days, due_on, realised_kr_value, adoption_pct, notes, stated_words, recorded_at, recorded_by)
  values (it.tenant_id, p_item, p_at_days, it.start_rollout + p_at_days, p_value, p_adoption, v_note, v_words, now(), auth.uid())
  on conflict (tenant_id, item_id, at_days) do update
    set realised_kr_value = excluded.realised_kr_value, adoption_pct = excluded.adoption_pct, notes = excluded.notes, stated_words = excluded.stated_words,
        recorded_at = excluded.recorded_at, recorded_by = excluded.recorded_by
  returning id into v_id;
  return v_id;
end $$;


create or replace function public.record_outcome_review(p_item uuid, p_at_days integer, p_value numeric, p_adoption numeric, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_at_days not in (30, 60, 90) then raise exception 'The review is at 30, 60 or 90 days' using errcode = 'PV005'; end if;
  select i.id, i.tenant_id, i.start_rollout, i.deleted_at into it from public.items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'Initiative not found' using errcode = 'PV005'; end if;
  perform public.gate_assert_editor(it.tenant_id);
  if it.start_rollout is null then raise exception 'This initiative has no Start Roll-Out date yet, so the review has no due date' using errcode = 'PV005'; end if;
  if p_value is null and p_adoption is null and v_note is null then raise exception 'Enter at least a value, an adoption %% or a note' using errcode = 'PV005'; end if;
  if p_adoption is not null and (p_adoption < 0 or p_adoption > 100) then raise exception 'Adoption is a percentage from 0 to 100' using errcode = 'PV005'; end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'The note is at most 2000 characters' using errcode = 'PV005'; end if;
  insert into public.outcome_reviews (tenant_id, item_id, at_days, due_on, realised_kr_value, adoption_pct, notes, recorded_at, recorded_by)
  values (it.tenant_id, p_item, p_at_days, it.start_rollout + p_at_days, p_value, p_adoption, v_note, now(), auth.uid())
  on conflict (tenant_id, item_id, at_days) do update
    set realised_kr_value = excluded.realised_kr_value, adoption_pct = excluded.adoption_pct, notes = excluded.notes, stated_words = null,
        recorded_at = excluded.recorded_at, recorded_by = excluded.recorded_by
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.record_outcome_review_as_claude(uuid, integer, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_outcome_review_as_claude(uuid, integer, numeric, numeric, text, text) to authenticated;
