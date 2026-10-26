-- 0034: the participant flow: progress, votes and the ballot functions (issue #125). Privacy model: docs/19-ALIGNMENT-PRIVACY.md.
-- alignment_ballots gets the person's saved progress (what they have picked so far) and a revision number: a save with an older revision
--   than the one stored is ignored, so a reload, the back button or a slow network can never overwrite newer answers or count twice.
-- alignment_votes: the answers, one row per ballot and initiative of the session, written when the ballot is submitted and replaced when
--   a person changes their vote before the session closes. Linked to the ballot, not to a name. Not readable through the API.
--   rank (top 5 with duels: 1 is best, empty = not picked), coins, or impact / confidence / ease (ICE, 1 to 10).
-- Only the server (service role) calls the ballot functions, after it has checked the personal link and the browser.
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
alter table public.alignment_ballots
  add column progress jsonb not null default '{}' check (jsonb_typeof(progress) = 'object' and pg_column_size(progress) < 20000),
  add column revision integer not null default 0 check (revision >= 0);

create table public.alignment_votes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  ballot_id uuid not null,
  alignment_item_id uuid not null,
  rank smallint check (rank between 1 and 5),
  coins smallint check (coins between 0 and 1000),
  impact smallint check (impact between 1 and 10),
  confidence smallint check (confidence between 1 and 10),
  ease smallint check (ease between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ballot_id) references public.alignment_ballots (tenant_id, id) on delete cascade,
  foreign key (alignment_item_id) references public.alignment_items (id) on delete cascade,
  unique (ballot_id, alignment_item_id)
);
create index alignment_votes_tenant on public.alignment_votes (tenant_id, session_id);
create trigger alignment_votes_meta before insert or update on public.alignment_votes
  for each row execute function public.set_write_meta();
alter table public.alignment_votes enable row level security;
revoke all on public.alignment_votes from public, anon, authenticated;
grant all on public.alignment_votes to service_role;

-- The participant behind a personal link, checked for everything a ballot needs. Raises PV011 when the person has not consented.
create function pv_internal.ballot_participant(p_participant uuid, p_need_open boolean)
returns public.alignment_participants
language plpgsql security definer set search_path = '' as $$
declare
  p public.alignment_participants%rowtype;
  s public.alignment_sessions%rowtype;
begin
  select * into p from public.alignment_participants where id = p_participant;
  if not found or p.removed_at is not null then raise exception 'This link is not valid.' using errcode = '22023'; end if;
  if p.consent_at is null then raise exception 'Agree to the terms first.' using errcode = 'PV011'; end if;
  select * into s from public.alignment_sessions where id = p.session_id;
  if p_need_open and s.status <> 'open' then raise exception 'This session is not open.' using errcode = '22023'; end if;
  return p;
end $$;
revoke all on function pv_internal.ballot_participant(uuid, boolean) from public, anon, authenticated;

-- The person's ballot (made on first use) with the progress they saved.
create function public.alignment_ballot_get(p_participant uuid)
returns table (ballot_id uuid, state text, progress jsonb, revision integer, submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  p public.alignment_participants%rowtype;
begin
  p := pv_internal.ballot_participant(p_participant, false);
  perform set_config('app.via', 'system', true);
  if (select status from public.alignment_sessions where id = p.session_id) = 'open' then
    insert into public.alignment_ballots (tenant_id, session_id, participant_id, group_id) values (p.tenant_id, p.session_id, p.id, p.group_id)
    on conflict (session_id, participant_id) where participant_id is not null do nothing;
  end if;
  return query select b.id, b.state, b.progress, b.revision, b.submitted_at from public.alignment_ballots b where b.session_id = p.session_id and b.participant_id = p.id;
end $$;
revoke all on function public.alignment_ballot_get(uuid) from public, anon, authenticated;
grant execute on function public.alignment_ballot_get(uuid) to service_role;

-- Saves progress. A save older than the stored one is ignored; the answer says which revision is stored.
create function public.alignment_ballot_save(p_participant uuid, p_progress jsonb, p_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p public.alignment_participants%rowtype;
  b public.alignment_ballots%rowtype;
begin
  p := pv_internal.ballot_participant(p_participant, true);
  if jsonb_typeof(p_progress) <> 'object' or pg_column_size(p_progress) >= 20000 or p_revision is null or p_revision < 0 then raise exception 'Bad progress.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);
  select * into b from public.alignment_ballots where session_id = p.session_id and participant_id = p.id for update;
  if not found then raise exception 'Open the ballot first.' using errcode = '22023'; end if;
  if p_revision > b.revision then
    update public.alignment_ballots set progress = p_progress, revision = p_revision where id = b.id;
    return p_revision;
  end if;
  return b.revision;
end $$;
revoke all on function public.alignment_ballot_save(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.alignment_ballot_save(uuid, jsonb, integer) to service_role;

-- Submits (or changes) the vote. The answers are checked against the method of the session; the votes are replaced in one step, so
-- sending the same answers twice gives the same result. {"ranking": [ids]} | {"coins": {id: n}} | {"ice": {id: {impact, confidence, ease}}}
create function public.alignment_ballot_submit(p_participant uuid, p_answers jsonb, p_revision integer)
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
    on conflict (ballot_id, alignment_item_id) do update set rank = excluded.rank, coins = null, impact = null, confidence = null, ease = null;
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
    on conflict (ballot_id, alignment_item_id) do update set coins = excluded.coins, rank = null, impact = null, confidence = null, ease = null;
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
    on conflict (ballot_id, alignment_item_id) do update set impact = excluded.impact, confidence = excluded.confidence, ease = excluded.ease, rank = null, coins = null;
  else
    raise exception 'Unknown method.' using errcode = '22023';
  end if;
  update public.alignment_ballots set state = 'submitted', submitted_at = coalesce(submitted_at, now()), progress = p_answers, revision = greatest(revision, coalesce(p_revision, 0)) where id = b.id;
end $$;
revoke all on function public.alignment_ballot_submit(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.alignment_ballot_submit(uuid, jsonb, integer) to service_role;
