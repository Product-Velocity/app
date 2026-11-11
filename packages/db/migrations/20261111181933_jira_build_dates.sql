-- Issue #421: Start Building and Build Completed from the tracker's own dates (Jira first).
-- Found on R8P-7049: a followed Jira initiative had Build Status In progress but no Start Building (only a phase change set it, to the day we
-- noticed) and no Build Completed or build days (only GitHub had gh_closed_at). Decided with Ashu 2026-11-11 (docs/decisions/2026-11-11-tracker-build-dates.md).
--   * item_jira_links.jira_resolved_at: when the linked Jira issue was resolved (its resolution date) while its status category is done.
--   * jira_apply_build_dates(connection, site, rows): service role only, the Jira twin of the date half of the tracker read. rows =
--     [{key, started, resolved}], at most 500, ONE connection and site. started = the earliest time the issue or any child first moved into the
--     in-progress or done category (read from issue history by the app); resolved = the resolution date, null while the issue is not done.
--     For each row that has an item_jira_links row: items.start_building = the UTC date of `started` when it differs (the tracker's real date
--     wins over the day we noticed; nothing is written when equal); jira_resolved_at = `resolved` when it differs. A null `started` changes
--     nothing (no history is not "never started"). Initiative Phase and Initiative Status are never touched. A deleted initiative is skipped.
--     Source of every write is 'system' (app.via), so the audit log shows source, old and new value.
--   * item_build_cycle(): replaced (create or replace, same columns; no other open branch replaces it, checked 2026-11-11). Build started is the
--     first time the phase became Build, else Start Building; build completed is the GitHub ticket close, else the Jira resolution while done.
-- No DROP statements. No new table (item_jira_links keeps its tenant RLS and index).
alter table public.item_jira_links add column jira_resolved_at timestamptz;

create function public.jira_apply_build_dates(p_connection uuid, p_site text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  l public.item_jira_links%rowtype;
  i public.items%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_changes jsonb;
  v_start date;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'Up to 500 issues at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);
  for r in select * from jsonb_to_recordset(p_rows) as x(key text, started timestamptz, resolved timestamptz) loop
    if r.key is null or r.key !~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$' then continue; end if;
    select * into l from public.item_jira_links x where x.connection_id = p_connection and x.site_id = p_site and x.issue_key = r.key for update;
    if not found then continue; end if;
    select * into i from public.items x where x.id = l.item_id and x.deleted_at is null for update;
    if not found then continue; end if;
    v_changes := '{}'::jsonb;
    if r.started is not null then
      v_start := (r.started at time zone 'UTC')::date;
      if i.start_building is distinct from v_start then
        update public.items set start_building = v_start where id = i.id;
        v_changes := v_changes || jsonb_build_object('start_building', jsonb_build_array(i.start_building, v_start));
      end if;
    end if;
    if l.jira_resolved_at is distinct from r.resolved then
      update public.item_jira_links set jira_resolved_at = r.resolved where id = l.id;
      v_changes := v_changes || jsonb_build_object('jira_resolved_at', jsonb_build_array(l.jira_resolved_at, r.resolved));
    end if;
    v_out := v_out || jsonb_build_object('key', r.key, 'item_id', l.item_id, 'changes', v_changes);
  end loop;
  return v_out;
end $$;
revoke all on function public.jira_apply_build_dates(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.jira_apply_build_dates(uuid, text, jsonb) to service_role;

create or replace function public.item_build_cycle(p_tenant uuid)
returns table (item_id uuid, build_started_at timestamptz, build_completed_at timestamptz, build_days numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select s.id, s.started, s.completed,
           -- Start Building is a date (counted from the start of that day), so a same-day finish is never negative
           case when s.started is not null and s.completed is not null and s.completed::date >= s.started::date
                then round(greatest(extract(epoch from (s.completed - s.started)), 0) / 86400, 2) end
    from (
      select i.id,
             coalesce(
               (select min(a.at) from public.audit_log a
                 where a.tenant_id = p_tenant and a.entity = 'items' and a.entity_id = i.id
                   and a.field = 'initiative_phase' and a.new = to_jsonb('Build'::text)),
               (i.start_building::timestamp at time zone 'UTC')) as started,
             coalesce(
               (select l.gh_closed_at from public.item_github_links l
                 where l.tenant_id = p_tenant and l.item_id = i.id and l.gh_state = 'closed_completed'),
               (select j.jira_resolved_at from public.item_jira_links j
                 where j.tenant_id = p_tenant and j.item_id = i.id and j.jira_status_category = 'done')) as completed
      from public.items i
      where i.tenant_id = p_tenant and i.deleted_at is null
    ) s;
end $$;
