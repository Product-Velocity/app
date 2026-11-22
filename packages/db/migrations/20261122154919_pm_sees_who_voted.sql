-- Issue #592 (Ashu, 2026-11-22): the PM role (Creator) may see who voted what, in closed sessions. Changes rule 7: "admins see names" becomes
-- "admins and Creators see names". What stays as it was: Show names needs a reason of 5 to 300 characters, writes the audit entry first, is refused for
-- Claude and service accounts (PV004), and returns people in the order they joined, never ranked (rule 8).
-- What is new and narrower than for admins:
--   * a Creator can open names only for a closed or archived session (an admin can also while it is open, decision Q2 of docs/19);
--   * a Creator can open names only if everyone who joined the session agreed to the wording that names product managers
--     (consent_version 2026-11-v2 or later). People who agreed to the earlier wording ("workspace admins can see") are not exposed to Creators:
--     the call is refused for the whole session, and an admin still can;
--   * a Creator reads closed and archived sessions even when show_results is off, so there is a way to the page (alignment_sessions_select).
-- Admins are now checked as signed-in human admins (my_human_admin_tenant_ids), so a platform staff entry no longer opens names (docs/19 Q4: platform
-- staff never see ballots).
-- No DROP statements: CREATE OR REPLACE on the function (same signature) and ALTER POLICY.
create function public.my_creator_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.tenant_members
   where user_id = auth.uid() and status = 'active' and role = 'creator' and not is_service_account
$$;
revoke all on function public.my_creator_tenant_ids() from public, anon;
grant execute on function public.my_creator_tenant_ids() to authenticated;

alter policy alignment_sessions_select on public.alignment_sessions
  using (
    tenant_id = any (array (select public.my_admin_tenant_ids()))
    or (tenant_id = any (array (select public.my_tenant_ids())) and status in ('closed', 'archived') and show_results)
    or (tenant_id = any (array (select public.my_creator_tenant_ids())) and status in ('closed', 'archived'))
  );

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
    if exists (
      select 1 from public.alignment_participants p
       where p.session_id = p_session and p.removed_at is null and p.consent_at is not null
         and (p.consent_version is null or p.consent_version < '2026-11-v2')
    ) then
      raise exception 'Some participants agreed to the earlier wording, in which only admins see names. Ask an admin.' using errcode = '42501';
    end if;
  end if;
  select count(*) into v_n from public.alignment_participants p where p.session_id = p_session and p.removed_at is null;
  insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
  values (s.tenant_id, 'alignment_sessions', s.id, 'names_revealed', to_jsonb(v_n), to_jsonb(btrim(p_reason)), auth.uid(), public.write_source());
  return query
    select p.name, p.email, p.group_id,
           coalesce(b.state = 'submitted', false),
           coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item', i.shown_name, 'rank', v.rank, 'coins', v.coins, 'impact', v.impact, 'confidence', v.confidence, 'ease', v.ease)) order by i.position)
                       from public.alignment_votes v join public.alignment_items i on i.id = v.alignment_item_id
                      where v.ballot_id = b.id and (v.rank is not null or coalesce(v.coins, 0) > 0 or v.impact is not null)), '[]'::jsonb)
      from public.alignment_participants p
      left join public.alignment_ballots b on b.participant_id = p.id and b.session_id = p.session_id
     where p.session_id = p_session and p.removed_at is null
     order by p.seq;
end $$;
