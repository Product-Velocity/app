-- 0035: alignment results (issue #126). Privacy model: docs/19-ALIGNMENT-PRIVACY.md.
-- results_snapshot (set once when the session is closed or archived, by the server after it has scored the votes in @pv/domain) can never
--   be changed or removed afterwards (PV009): what was decided on stays what was shown, even after personal data is cleared.
--   It holds aggregates only: scores per initiative, group names and sizes of groups of 5 or more, never a name, an address or a small group.
-- alignment_results_store(): the server's one way to write it (service role only), and only if it is still empty.
-- alignment_reveal_names(): "Show names". An admin gives a reason (at least 5 characters); every call writes an audit entry (who, when,
--   why, how many people were shown) before any name is returned; a person only, never Claude or a service account. Returns each person
--   with their answers, in the order they joined (never ranked, rule 8). Allowed while the session is open too (decision Q2).
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
create function public.alignment_results_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.results_snapshot is not null and new.results_snapshot is distinct from old.results_snapshot then
    raise exception 'The results of a closed session cannot change.' using errcode = 'PV009';
  end if;
  return new;
end $$;
create trigger alignment_sessions_results_immutable before update on public.alignment_sessions
  for each row execute function public.alignment_results_immutable();

create function public.alignment_results_store(p_session uuid, p_snapshot jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
begin
  if jsonb_typeof(p_snapshot) <> 'object' or pg_column_size(p_snapshot) >= 200000 then raise exception 'Bad results.' using errcode = '22023'; end if;
  select * into s from public.alignment_sessions where id = p_session for update;
  if not found or s.status not in ('closed', 'archived') then raise exception 'The session is not closed.' using errcode = '22023'; end if;
  if s.results_snapshot is not null then return false; end if;
  perform set_config('app.via', 'system', true);
  update public.alignment_sessions set results_snapshot = p_snapshot where id = p_session;
  return true;
end $$;
revoke all on function public.alignment_results_store(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.alignment_results_store(uuid, jsonb) to service_role;

create function public.alignment_reveal_names(p_session uuid, p_reason text)
returns table (name text, email text, group_id text, voted boolean, answers jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_n integer;
begin
  perform pv_internal.refuse_claude();
  select * into s from public.alignment_sessions where id = p_session;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot see the names of this session.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 300 then
    raise exception 'Give a reason of 5 to 300 characters. It is written to the audit log.' using errcode = '22023';
  end if;
  if s.status = 'draft' then raise exception 'The session has not opened yet.' using errcode = '22023'; end if;
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
revoke all on function public.alignment_reveal_names(uuid, text) from public, anon;
grant execute on function public.alignment_reveal_names(uuid, text) to authenticated;
