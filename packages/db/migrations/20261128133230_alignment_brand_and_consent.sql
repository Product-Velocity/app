-- Issue #750, part 2 (docs/decisions/2026-11-28-voter-consent-optional.md, 2026-11-28-company-brand.md): what a voting session shows and asks.
-- 1. use_brand: the session uses the company brand when the workspace has a confirmed brand switched on for voting (default yes; an admin can opt a session out).
-- 2. consent_required: whether voters accept wording before voting. **Off by default** (Ashu, 2026-11-28): a vote runs inside one company, whose own policies apply.
--    Sessions that already exist keep the step they had (they were run with consent): the column is added with default true, which fills the existing rows
--    without an update, and the default is then set to false for new sessions.
-- 3. names_ack_*: with the consent step off, an admin can acknowledge in writing that the company's own policy covers the vote, including that admins and Creators
--    can see who voted what. Without that, Creators cannot open names on such a session (admins still can). With the step on, the old rule stands: every
--    participant agreed to the wording that names product managers (2026-11-v2 or later).
-- All three lock when the session opens like the other settings. Replaced: alignment_sessions_lock (adds them) and alignment_reveal_names (the Creator rule above;
--   also lists a voter's MoSCoW choice, which the answers list left out). No other open branch replaces either.
alter table public.alignment_sessions
  add column use_brand boolean not null default true,
  add column consent_required boolean not null default true,
  add column names_ack_by uuid references auth.users (id) on delete set null,
  add column names_ack_at timestamptz,
  add column names_ack_version text check (names_ack_version is null or char_length(names_ack_version) <= 40),
  add constraint alignment_sessions_names_ack_check check ((names_ack_at is null) = (names_ack_version is null) and (names_ack_at is null or not consent_required));
alter table public.alignment_sessions alter column consent_required set default false;

create or replace function public.alignment_sessions_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- settings are locked once the session is open; the state itself, the times it was opened and closed and the results can still change
  if old.status <> 'draft' and (
       new.name, new.method, new.groups, new.weighting, new.excluded_groups, new.coins_total, new.coins_max_per_item, new.show_results, new.retention_months, new.cycle_id, new.opens_at, new.voter_fields,
       new.use_brand, new.consent_required, new.names_ack_at, new.names_ack_by, new.names_ack_version
     ) is distinct from (
       old.name, old.method, old.groups, old.weighting, old.excluded_groups, old.coins_total, old.coins_max_per_item, old.show_results, old.retention_months, old.cycle_id, old.opens_at, old.voter_fields,
       old.use_brand, old.consent_required, old.names_ack_at, old.names_ack_by, old.names_ack_version
     ) then
    raise exception 'The settings of an open session are locked. Make a new session instead.' using errcode = 'PV009';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'An archived session stays archived.' using errcode = 'PV009';
  end if;
  return new;
end $$;

-- The look and the consent of a draft session (the lock trigger refuses anything else). A person only: Claude and service accounts cannot acknowledge for the company.
create function public.alignment_session_set_voting_options(p_id uuid, p_use_brand boolean, p_consent_required boolean, p_names_ack boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
begin
  perform pv_internal.refuse_claude();
  select * into s from public.alignment_sessions where id = p_id for update;
  if not found or s.tenant_id <> all (array (select public.my_human_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_sessions set
    use_brand = coalesce(p_use_brand, use_brand),
    consent_required = coalesce(p_consent_required, consent_required),
    names_ack_by = case when not coalesce(p_consent_required, consent_required) and coalesce(p_names_ack, false) then coalesce(names_ack_by, auth.uid()) end,
    names_ack_at = case when not coalesce(p_consent_required, consent_required) and coalesce(p_names_ack, false) then coalesce(names_ack_at, now()) end,
    names_ack_version = case when not coalesce(p_consent_required, consent_required) and coalesce(p_names_ack, false) then coalesce(names_ack_version, '2026-11-v1') end
   where id = p_id;
end $$;
revoke all on function public.alignment_session_set_voting_options(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.alignment_session_set_voting_options(uuid, boolean, boolean, boolean) to authenticated;

create or replace function public.alignment_reveal_names(p_session uuid, p_reason text)
returns table (name text, email text, group_id text, voted boolean, answers jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_n integer;
  v_admin boolean;
begin
  perform pv_internal.refuse_claude();
  select * into s from public.alignment_sessions where id = p_session;
  v_admin := found and s.tenant_id = any (array (select public.my_human_admin_tenant_ids()));
  if not found or not (v_admin or s.tenant_id = any (array (select public.my_creator_tenant_ids()))) then
    raise exception 'You cannot see the names of this session.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 300 then
    raise exception 'Give a reason of 5 to 300 characters. It is written to the audit log.' using errcode = '22023';
  end if;
  if s.status = 'draft' then raise exception 'The session has not opened yet.' using errcode = '22023'; end if;
  if not v_admin then
    if s.status not in ('closed', 'archived') then
      raise exception 'Names can be opened once the session has closed.' using errcode = '42501';
    end if;
    if s.consent_required then
      -- every participant who joined agreed to the wording that names product managers
      if exists (
        select 1 from public.alignment_participants p
         where p.session_id = p_session and p.removed_at is null and p.consent_at is not null
           and (p.consent_version is null or p.consent_version !~ '^[0-9]{4}-[0-9]{2}-v[0-9]+$' or p.consent_version < '2026-11-v2')
      ) then
        raise exception 'Some participants agreed to the earlier wording, in which only admins see names. Ask an admin.' using errcode = '42501';
      end if;
    elsif s.names_ack_at is null then
      -- no consent step: the admin has to have acknowledged, in writing, that the company's own policy covers it
      raise exception 'This session had no consent step and its admin did not acknowledge that Creators can see names. Ask an admin.' using errcode = '42501';
    end if;
  end if;
  select count(*) into v_n from public.alignment_participants p where p.session_id = p_session and p.removed_at is null;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (s.tenant_id, 'alignment_sessions', s.id, 'names_revealed', to_jsonb(v_n), to_jsonb(btrim(p_reason)), auth.uid(), public.write_source());
  return query
    select p.name, p.email, p.group_id,
           coalesce(b.state = 'submitted', false),
           coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item', i.shown_name, 'rank', v.rank, 'coins', v.coins, 'impact', v.impact, 'confidence', v.confidence, 'ease', v.ease, 'moscow', v.moscow)) order by i.position)
                       from public.alignment_votes v join public.alignment_items i on i.id = v.alignment_item_id
                      where v.ballot_id = b.id and (v.rank is not null or coalesce(v.coins, 0) > 0 or v.impact is not null or v.moscow is not null)), '[]'::jsonb)
      from public.alignment_participants p
      left join public.alignment_ballots b on b.participant_id = p.id and b.session_id = p.session_id
     where p.session_id = p_session and p.removed_at is null
     order by p.seq;
end $$;
