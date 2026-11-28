-- MoSCoW as a fourth alignment method (issue #746, docs/decisions/2026-11-28-alignment-moscow-and-small-groups.md).
-- Each voter chooses Must, Should, Could or Won't (stored as must, should, could, wont) for every initiative of the session: there is no
-- "no opinion", so a ballot is only accepted when every initiative has a choice. The vote informs; a person sets the MoSCoW field (slice 2).
-- Forward-only: the method check is widened (the old check is replaced in one statement), a nullable column is added, and
-- alignment_ballot_submit gets a moscow branch (the other branches are unchanged apart from clearing the new column).
alter table public.alignment_sessions drop constraint alignment_sessions_method_check;
alter table public.alignment_sessions add constraint alignment_sessions_method_check check (method in ('top5_duels', 'coins', 'ice', 'moscow'));

alter table public.alignment_votes add column moscow text check (moscow in ('must', 'should', 'could', 'wont'));

create or replace function public.alignment_ballot_submit(p_participant uuid, p_answers jsonb, p_revision integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.alignment_participants%rowtype;
  s public.alignment_sessions%rowtype;
  b public.alignment_ballots%rowtype;
  v_items uuid[];
  v_n integer;
  v_k integer;
  v_ids uuid[];
  v_sum integer;
  r record;
  v_val jsonb;
begin
  p := pv_internal.ballot_participant(p_participant, true);
  select * into s from public.alignment_sessions where id = p.session_id;
  select array_agg(i.id order by i.position) into v_items from public.alignment_items i where i.session_id = s.id;
  v_n := coalesce(array_length(v_items, 1), 0);
  if jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) >= 20000 then raise exception 'Bad answers.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);
  select * into b from public.alignment_ballots where session_id = s.id and participant_id = p.id for update;
  if not found then raise exception 'Open the ballot first.' using errcode = '22023'; end if;

  if s.method = 'top5_duels' then
    v_k := least(5, v_n);
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_answers -> 'ranking', '[]'::jsonb)) x;
    if coalesce(array_length(v_ids, 1), 0) <> v_k or (select count(distinct y) from unnest(v_ids) y) <> v_k or not (v_ids <@ v_items) then
      raise exception 'Choose exactly % initiatives, each once.', v_k using errcode = '22023';
    end if;
    insert into public.alignment_votes (tenant_id, session_id, ballot_id, alignment_item_id, rank)
    select s.tenant_id, s.id, b.id, it, (select o.ord::smallint from unnest(v_ids) with ordinality as o(id, ord) where o.id = it)
      from unnest(v_items) it
    on conflict (ballot_id, alignment_item_id) do update set rank = excluded.rank, coins = null, impact = null, confidence = null, ease = null, moscow = null;
  elsif s.method = 'coins' then
    if jsonb_typeof(p_answers -> 'coins') <> 'object' then raise exception 'Spend your coins first.' using errcode = '22023'; end if;
    v_sum := 0;
    for r in select key, value from jsonb_each_text(p_answers -> 'coins') loop
      if r.key !~ '^[0-9a-f-]{36}$' or not (r.key::uuid = any (v_items)) then raise exception 'Unknown initiative.' using errcode = '22023'; end if;
      if r.value !~ '^[0-9]{1,4}$' or r.value::integer > s.coins_max_per_item then raise exception 'At most % coins on one initiative.', s.coins_max_per_item using errcode = '22023'; end if;
      v_sum := v_sum + r.value::integer;
    end loop;
    if v_sum <> s.coins_total then raise exception 'Spend all % coins (you have spent %).', s.coins_total, v_sum using errcode = '22023'; end if;
    insert into public.alignment_votes (tenant_id, session_id, ballot_id, alignment_item_id, coins)
    select s.tenant_id, s.id, b.id, it, coalesce((p_answers -> 'coins' ->> it::text)::integer, 0) from unnest(v_items) it
    on conflict (ballot_id, alignment_item_id) do update set coins = excluded.coins, rank = null, impact = null, confidence = null, ease = null, moscow = null;
  elsif s.method = 'ice' then
    if jsonb_typeof(p_answers -> 'ice') <> 'object' then raise exception 'Score the initiatives first.' using errcode = '22023'; end if;
    for r in select it from unnest(v_items) it loop
      v_val := p_answers -> 'ice' -> r.it::text;
      if v_val is null or (v_val ->> 'impact') !~ '^([1-9]|10)$' or (v_val ->> 'confidence') !~ '^([1-9]|10)$' or (v_val ->> 'ease') !~ '^([1-9]|10)$' then
        raise exception 'Score every initiative from 1 to 10 on impact, confidence and ease.' using errcode = '22023';
      end if;
    end loop;
    insert into public.alignment_votes (tenant_id, session_id, ballot_id, alignment_item_id, impact, confidence, ease)
    select s.tenant_id, s.id, b.id, it, (p_answers -> 'ice' -> it::text ->> 'impact')::smallint, (p_answers -> 'ice' -> it::text ->> 'confidence')::smallint, (p_answers -> 'ice' -> it::text ->> 'ease')::smallint
      from unnest(v_items) it
    on conflict (ballot_id, alignment_item_id) do update set impact = excluded.impact, confidence = excluded.confidence, ease = excluded.ease, rank = null, coins = null, moscow = null;
  elsif s.method = 'moscow' then
    -- every initiative of the session needs one of must, should, could, wont: there is no "no opinion"
    if jsonb_typeof(p_answers -> 'moscow') <> 'object' then raise exception 'Choose Must, Should, Could or Won''t for every initiative first.' using errcode = '22023'; end if;
    for r in select key, value from jsonb_each_text(p_answers -> 'moscow') loop
      if r.key !~ '^[0-9a-f-]{36}$' or not (r.key::uuid = any (v_items)) then raise exception 'Unknown initiative.' using errcode = '22023'; end if;
      if r.value not in ('must', 'should', 'could', 'wont') then raise exception 'Choose Must, Should, Could or Won''t.' using errcode = '22023'; end if;
    end loop;
    for r in select it from unnest(v_items) it loop
      if not jsonb_exists(p_answers -> 'moscow', r.it::text) then raise exception 'Choose Must, Should, Could or Won''t for every initiative.' using errcode = '22023'; end if;
    end loop;
    insert into public.alignment_votes (tenant_id, session_id, ballot_id, alignment_item_id, moscow)
    select s.tenant_id, s.id, b.id, it, p_answers -> 'moscow' ->> it::text from unnest(v_items) it
    on conflict (ballot_id, alignment_item_id) do update set moscow = excluded.moscow, rank = null, coins = null, impact = null, confidence = null, ease = null;
  else
    raise exception 'Unknown method.' using errcode = '22023';
  end if;
  update public.alignment_ballots set state = 'submitted', submitted_at = coalesce(submitted_at, now()), progress = p_answers, revision = greatest(revision, coalesce(p_revision, 0)) where id = b.id;
end $$;
revoke all on function public.alignment_ballot_submit(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.alignment_ballot_submit(uuid, jsonb, integer) to service_role;
