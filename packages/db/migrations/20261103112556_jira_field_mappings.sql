-- jira_field_mappings: the Jira field catalog cache and the field mapping per project link (docs/16 point 3; issues #69 and #70).
-- jira_field_catalogs: what was last read from the Jira site (every field: id, name, system or custom, kind, role hint, how many of a sample of the
--   project's issues have a value). A cache so the page does not call Jira on every view; written by the app server only (service role) after
--   it checked the person is a human admin; read by human admins only. Not audited (it is a copy of Jira, replaced on every refresh), like jira_reads.
-- jira_field_mappings: which Jira field (by ID: names are not unique on a site) maps to which Product Velocity field of the 170-field
--   dictionary, read only or two-way, per project link. Written only through jira_set_field_mapping() / jira_remove_field_mapping() by a human
--   admin (never Claude, a service account or platform staff). Members read it (the sync reads it as the signed-in person). Audited.
-- jira_mapping_check(): the same rules as packages/domain/src/jira-field-mapping.ts (the table of allowed pairs), kept in step by a database test
--   that compares the two over every dictionary field. Commercial, person-only, tracker-driven and status fields are refused in both directions.
-- Functions replaced by this migration: none. No DROP statements.

create table public.jira_field_catalogs (
  link_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  sampled integer not null default 0 check (sampled between 0 and 1000),
  refreshed_at timestamptz not null default now(),
  refreshed_by uuid references auth.users (id) on delete set null,
  error text check (error is null or length(error) <= 300),
  unique (tenant_id, link_id),
  foreign key (tenant_id, link_id) references public.jira_project_links (tenant_id, id) on delete cascade
);
create index jira_field_catalogs_tenant_idx on public.jira_field_catalogs (tenant_id, link_id);
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_field_catalogs
  for each row execute function platform.readonly_guard();
alter table public.jira_field_catalogs enable row level security;
create policy jira_field_catalogs_select on public.jira_field_catalogs for select to authenticated
  using (tenant_id = any (array (select public.my_human_admin_tenant_ids())));
revoke all on public.jira_field_catalogs from public, anon, authenticated;
grant select on public.jira_field_catalogs to authenticated;
grant all on public.jira_field_catalogs to service_role;

create table public.jira_field_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  link_id uuid not null,
  jira_field_id text not null check (jira_field_id ~ '^[A-Za-z0-9_.-]{1,64}$'),
  jira_field_name text not null check (length(jira_field_name) between 1 and 200),
  jira_kind text not null check (jira_kind in ('text', 'number', 'date', 'datetime', 'select', 'multi-select', 'user', 'users', 'labels', 'sprint', 'link', 'team', 'parent', 'other')),
  jira_custom boolean not null,
  pv_field text not null check (pv_field ~ '^[a-z][a-z0-9_]{1,63}$'),
  direction text not null check (direction in ('read', 'two_way')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  unique (tenant_id, id),
  unique (link_id, jira_field_id),
  unique (link_id, pv_field),
  foreign key (tenant_id, link_id) references public.jira_project_links (tenant_id, id) on delete cascade
);
create index jira_field_mappings_tenant_idx on public.jira_field_mappings (tenant_id, link_id);
create trigger jira_field_mappings_meta before insert or update on public.jira_field_mappings
  for each row execute function public.set_write_meta();
create trigger jira_field_mappings_audit after insert or update or delete on public.jira_field_mappings
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.jira_field_mappings
  for each row execute function platform.readonly_guard();
alter table public.jira_field_mappings enable row level security;
create policy jira_field_mappings_select on public.jira_field_mappings for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.jira_field_mappings from public, anon, authenticated;
grant select on public.jira_field_mappings to authenticated;
grant all on public.jira_field_mappings to service_role;

-- The rules for a pair. Returns null when the pair is allowed, otherwise the code of the refusal (the codes of MappingRefusal in the TypeScript).
-- A PV field outside every list below is refused as not_for_jira: the whitelist of targets is the only way in.
create function public.jira_mapping_check(p_jira_id text, p_jira_custom boolean, p_kind text, p_pv text, p_direction text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  c_commercial constant text[] := array[
    'value_type', 'value_12m', 'value_basis', 'value_weighted', 'value_weighted_per_build_week', 'time_to_first_revenue_months', 'confidence',
    'customers_requesting', 'target_customers', 'customers_live', 'cost_of_not_doing',
    'kr_metric', 'kr_start', 'kr_target', 'kr_unit', 'kr_direction', 'realized_kr_value', 'kr_realized_pct', 'realized_per_year', 'value_variance_pct',
    'decision', 'decided_by', 'decision_date', 'stack_rank', 'previous_rank', 'project_rank',
    'outcome_status', 'outcome_verdict', 'outcome_review_date', 'learning', 'measured_period', 'retention_pct', 'support_hours_saved_month',
    'adoption_pct', 'rollout_pct', 'time_to_first_use_days', 'target_scope', 'live_scope', 'target_segments', 'gtm_enablement_notes', 'request_origin'];
  c_private constant text[] := array['crowd_rank', 'crowd_score', 'crowd_consensus', 'crowd_votes', 'alignment_status', 'align_why', 'align_what', 'align_how', 'align_when'];
  c_tracker constant text[] := array[
    'status', 'sync_state', 'gh_state', 'issues_closed', 'issues_total', 'delivery_progress_pct', 'open_prs', 'merged_prs', 'gh_last_activity', 'gh_project_status',
    'gh_iteration', 'gh_target_date', 'blocked_issues', 'stale_issues', 'scope_added', 'schedule_variance_pp', 'latest_release', 'ci_status', 'repositories',
    'github_links', 'planned_scope', 'breakdown_route', 'breakdown_status', 'last_synced', 'synced_with', 'tracker_ownership'];
  c_unmappable constant text[] := array['summary', 'description', 'status', 'statuscategory', 'resolution', 'resolutiondate', 'issuekey', 'id', 'key', 'issuetype', 'project', 'lastViewed', 'workratio', 'progress', 'aggregateprogress'];
  c_read_only constant text[] := c_unmappable || array[
    'created', 'updated', 'creator', 'reporter', 'comment', 'worklog', 'votes', 'watches', 'attachment', 'issuelinks', 'subtasks', 'thumbnail',
    'timetracking', 'timespent', 'timeestimate', 'timeoriginalestimate', 'aggregatetimespent', 'aggregatetimeestimate', 'aggregatetimeoriginalestimate', 'environment'];
  -- the targets: key -> Jira kinds it accepts, and whether it may be two-way (only fields on the Jira outbound allowlist)
  c_targets constant jsonb := '{
    "planned_start": {"accepts": ["date", "datetime"], "two_way": true},
    "g2m_date_est": {"accepts": ["date", "datetime"], "two_way": true},
    "moscow": {"accepts": ["select"], "two_way": true},
    "effort": {"accepts": ["select"], "two_way": false},
    "horizon": {"accepts": ["select"], "two_way": false},
    "theme": {"accepts": ["select", "text"], "two_way": false},
    "focus_area": {"accepts": ["select", "text"], "two_way": false},
    "estimate_low_weeks": {"accepts": ["number"], "two_way": false},
    "estimate_high_weeks": {"accepts": ["number"], "two_way": false},
    "tags": {"accepts": ["labels", "multi-select"], "two_way": false},
    "contributing_teams": {"accepts": ["team", "labels", "multi-select", "select"], "two_way": false},
    "assignees": {"accepts": ["user", "users"], "two_way": false}
  }';
  v_target jsonb := c_targets -> p_pv;
begin
  if p_direction is null or p_direction not in ('read', 'two_way') then return 'unknown_direction'; end if;
  if p_kind is null or p_kind not in ('text', 'number', 'date', 'datetime', 'select', 'multi-select', 'user', 'users', 'labels', 'sprint', 'link', 'team', 'parent', 'other') then return 'unknown_kind'; end if;
  if p_pv = 'initiative_status' then return 'status_people_only'; end if;
  if p_pv = any (c_tracker) then return 'tracker_driven'; end if;
  if p_pv = any (c_commercial) then return 'commercial'; end if;
  if p_pv = any (c_private) then return 'private'; end if;
  if v_target is null then return 'not_for_jira'; end if;
  if p_jira_id = any (c_unmappable) then return 'jira_unmappable'; end if;
  if not (v_target -> 'accepts') ? p_kind then return 'incompatible'; end if;
  if p_direction = 'two_way' then
    if not (v_target ->> 'two_way')::boolean then return 'two_way_not_allowed'; end if;
    if p_jira_id = any (c_read_only) or (not p_jira_custom and p_jira_id not in ('duedate', 'labels', 'priority')) then return 'jira_read_only'; end if;
    if p_kind not in ('text', 'number', 'date', 'datetime', 'select', 'labels') then return 'jira_read_only'; end if;
  end if;
  return null;
end $$;
revoke all on function public.jira_mapping_check(text, boolean, text, text, text) from public, anon;
grant execute on function public.jira_mapping_check(text, boolean, text, text, text) to authenticated, service_role;

create function public.jira_set_field_mapping(
  p_project uuid, p_jira_field_id text, p_jira_field_name text, p_jira_kind text, p_jira_custom boolean, p_pv_field text, p_direction text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_link uuid;
  v_code text;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change the Jira field mapping.' using errcode = '42501';
  end if;
  select id into v_link from public.jira_project_links where project_id = p_project and tenant_id = v_tenant;
  if v_link is null then raise exception 'That project is not linked to a Jira project.' using errcode = 'P0002'; end if;
  v_code := public.jira_mapping_check(p_jira_field_id, coalesce(p_jira_custom, false), p_jira_kind, p_pv_field, p_direction);
  if v_code is not null then
    raise exception 'This Jira field cannot be mapped that way (%).', v_code using errcode = 'PV011', hint = v_code;
  end if;
  if exists (select 1 from public.jira_field_mappings where link_id = v_link and pv_field = p_pv_field and jira_field_id <> p_jira_field_id) then
    raise exception 'That Product Velocity field is already mapped to another Jira field. Remove that mapping first.' using errcode = 'PV012';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  insert into public.jira_field_mappings (tenant_id, link_id, jira_field_id, jira_field_name, jira_kind, jira_custom, pv_field, direction)
    values (v_tenant, v_link, p_jira_field_id, p_jira_field_name, p_jira_kind, coalesce(p_jira_custom, false), p_pv_field, p_direction)
    on conflict (link_id, jira_field_id) do update set jira_field_name = excluded.jira_field_name, jira_kind = excluded.jira_kind,
      jira_custom = excluded.jira_custom, pv_field = excluded.pv_field, direction = excluded.direction
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.jira_set_field_mapping(uuid, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.jira_set_field_mapping(uuid, text, text, text, boolean, text, text) to authenticated;

create function public.jira_remove_field_mapping(p_project uuid, p_jira_field_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.projects where id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_human_admin_tenant_ids())) or public.write_source() = 'MCP' then
    raise exception 'Only a workspace admin can change the Jira field mapping.' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  delete from public.jira_field_mappings m using public.jira_project_links l
   where l.project_id = p_project and l.tenant_id = v_tenant and m.link_id = l.id and m.tenant_id = v_tenant and m.jira_field_id = p_jira_field_id;
end $$;
revoke all on function public.jira_remove_field_mapping(uuid, text) from public, anon;
grant execute on function public.jira_remove_field_mapping(uuid, text) to authenticated;
