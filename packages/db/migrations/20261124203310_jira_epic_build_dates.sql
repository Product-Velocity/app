-- Start Building and Build Completed for an initiative that only has epics read from Jira (issue #656 follow-up, Ashu 2026-11-24).
-- Found on R89 Roadmap (read-only Jira project, 56 initiatives, no Jira issue of their own): 0 had a build end and the 12 start dates were typed by Claude, because the
-- build dates of #421 live on item_jira_links and a read-only initiative has none. Nothing is written to Jira; this only stores what was read.
--   * item_jira_tree.resolved_at: when a level-1 epic was resolved (its resolution date) while its status category is done; null otherwise.
--   * jira_apply_epic_build_dates(connection, site, item, started, resolved): service role only, the twin of jira_apply_build_dates for read-only projects.
--     started = the earliest time any listed epic or child first moved into the in-progress or done category (read from history by the app): items.start_building =
--     its UTC date when it differs (Jira's real date wins over a typed one; a null started changes nothing). resolved = [{key, resolved}] for the epics: resolved_at
--     is set on those level-1 rows when it differs. Initiative Phase and Initiative Status are never touched. Same guard as jira_apply_epic_tree. Source 'system'.
--   * item_build_cycle(): replaced (create or replace, same columns): Build Completed falls back to the LATEST epic resolution once EVERY listed epic is done.
--   * items_computed: the same fallback for Building Time, applied by rewriting the stored view definition (as 20261118213038 does), so no later items column is lost.
-- Functions replaced: item_build_cycle only (checked against main 2026-11-24: no open PR replaces it). No DROP of data. No new table.

alter table public.item_jira_tree add column resolved_at timestamptz;

create function public.jira_apply_epic_build_dates(p_connection uuid, p_site text, p_item uuid, p_started timestamptz, p_resolved jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.items%rowtype;
  v_tenant uuid;
  v_start date;
  v_changes jsonb := '{}'::jsonb;
  v_rows integer := 0;
  r record;
begin
  if jsonb_typeof(p_resolved) <> 'array' or jsonb_array_length(p_resolved) > 500 then raise exception 'Up to 500 epics per initiative.' using errcode = '22023'; end if;
  select x.tenant_id into v_tenant from public.items x where x.id = p_item and x.deleted_at is null;
  if v_tenant is null then raise exception 'That initiative was not found.' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.items x join public.jira_project_links pl on pl.tenant_id = x.tenant_id and pl.project_id = x.home_project_id
     where x.id = p_item and pl.read_only and pl.connection_id = p_connection and pl.site_id = p_site
  ) or not exists (select 1 from public.item_jira_epic_requests q where q.item_id = p_item and q.tenant_id = v_tenant and q.state in ('pending', 'linked')) then
    raise exception 'That initiative has no epics listed in a read-only Jira project of this connection.' using errcode = '22023';
  end if;
  perform set_config('app.via', 'system', true);

  select * into i from public.items x where x.id = p_item and x.deleted_at is null for update;
  if p_started is not null then
    v_start := (p_started at time zone 'UTC')::date;
    if i.start_building is distinct from v_start then
      update public.items set start_building = v_start where id = p_item;
      v_changes := v_changes || jsonb_build_object('start_building', jsonb_build_array(i.start_building, v_start));
    end if;
  end if;
  for r in select * from jsonb_to_recordset(p_resolved) as x(key text, resolved timestamptz) loop
    if r.key is null or r.key !~ '^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$' then continue; end if;
    update public.item_jira_tree t set resolved_at = r.resolved
     where t.item_id = p_item and t.issue_key = r.key and t.level = 1 and t.resolved_at is distinct from r.resolved;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_changes := v_changes || jsonb_build_object('resolved_' || r.key, to_jsonb(r.resolved)); end if;
  end loop;
  return jsonb_build_object('changes', v_changes);
end $$;
revoke all on function public.jira_apply_epic_build_dates(uuid, text, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.jira_apply_epic_build_dates(uuid, text, uuid, timestamptz, jsonb) to service_role;

-- Build Completed of an initiative with only epics: the latest epic resolution, once every listed epic (level 1) is done and has a resolution date.
create function public.epics_build_end(p_tenant uuid, p_item uuid) returns timestamptz
language sql stable security invoker set search_path = '' as $$
  select max(t.resolved_at) from public.item_jira_tree t
   where t.tenant_id = p_tenant and t.item_id = p_item and t.level = 1
  having count(*) > 0 and bool_and(t.status_category = 'done' and t.resolved_at is not null)
$$;
revoke all on function public.epics_build_end(uuid, uuid) from public, anon;
grant execute on function public.epics_build_end(uuid, uuid) to authenticated;

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
                 where j.tenant_id = p_tenant and j.item_id = i.id and j.jira_status_category = 'done'),
               public.epics_build_end(p_tenant, i.id)) as completed
      from public.items i
      where i.tenant_id = p_tenant and i.deleted_at is null
    ) s;
end $$;

-- items_computed: Building Time follows the same end. The stored definition is rewritten in place, and the migration fails if the text it expects is not there.
do $$
declare
  v_def text := pg_get_viewdef('public.items_computed'::regclass, true);
  v_old constant text := '''done''::text)) AS build_end';
  v_new constant text := '''done''::text), public.epics_build_end(i.tenant_id, i.id)) AS build_end';
begin
  if position(v_old in v_def) = 0 then raise exception 'items_computed does not have the expected Building Time expression'; end if;
  v_def := replace(v_def, v_old, v_new);
  drop view public.items_computed;
  execute 'create view public.items_computed with (security_invoker = true) as ' || v_def;
  revoke all on public.items_computed from public, anon, authenticated;
  grant select on public.items_computed to authenticated;
end $$;
