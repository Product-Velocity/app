-- 0009: bring the items table in line with the field dictionary (docs/reference/item-fields.csv, 165 fields).
-- Column names become the dictionary keys; every field that ships in phase 1 exists; selects are constrained
-- to the dictionary's allowed values; multi-value fields get related tables; computed fields get a view.
-- Forward-only. Statements that drop a constraint or column cannot be run through the Supabase MCP tool
-- (its destructive-statement prompt hangs); apply this file in the Supabase SQL editor or with pnpm db:migrate.

-- ---------------------------------------------------------------------------
-- 1. Renames to dictionary keys
-- ---------------------------------------------------------------------------
alter table public.items rename column key to item_code;
alter table public.items rename column title to initiative_name;
alter table public.items rename column value to value_12m;
alter table public.items rename column size to effort;
alter table public.items rename column owner_user_id to product_manager;   -- the owner of 0008 is the dictionary's Product Manager
alter table public.items rename column end_date to g2m_date_est;           -- 0008 "End" is the estimated go-to-market date
alter table public.items rename column delivery_progress to delivery_progress_pct;
alter index public.items_owner_idx rename to items_product_manager_idx;

-- ---------------------------------------------------------------------------
-- 2. Selects: constrain to the dictionary's values (stored exactly as the dictionary spells them)
-- ---------------------------------------------------------------------------
alter table public.items drop constraint if exists items_moscow_check;
alter table public.items drop constraint if exists items_health_check;
alter table public.items drop constraint if exists items_date_precision_check;
alter table public.items drop constraint if exists items_confidence_check;
alter table public.items drop constraint if exists items_horizon_check;
alter table public.items drop constraint if exists items_focus_area_check;
alter table public.items drop constraint if exists items_decision_check;

update public.items set moscow = case moscow when 'must' then 'Must' when 'should' then 'Should' when 'could' then 'Could' when 'wont' then 'Won''t' end
 where moscow is not null;
update public.items set health = case health when 'on_track' then 'On Track' when 'at_risk' then 'At Risk' when 'delayed' then 'Delayed' end
 where health is not null;
update public.items set date_precision = case date_precision when 'day' then 'Day' when 'month' then 'Month' else 'Quarter' end;
update public.items set horizon = case lower(btrim(horizon)) when 'now' then 'Now' when 'next' then 'Next' when 'later' then 'Later' end
 where horizon is not null;
update public.items set focus_area = case lower(btrim(focus_area))
    when 'formats' then 'Formats' when 'demand/optimisation' then 'Demand/Optimisation' when 'publishers' then 'Publishers' end
 where focus_area is not null;
update public.items set decision = case lower(btrim(decision))
    when 'go' then 'Go' when 'hold' then 'Hold' when 'kill' then 'Kill' when 'not yet decided' then 'Not yet decided' end
 where decision is not null;

-- confidence was a 0-100 number; the dictionary has High / Medium / Low
alter table public.items alter column confidence type text using case
  when confidence is null then null when confidence >= 70 then 'High' when confidence >= 40 then 'Medium' else 'Low' end;
alter table public.items alter column date_precision set default 'Day';

alter table public.items
  add constraint items_moscow_check check (moscow in ('Must', 'Should', 'Could', 'Won''t')),
  add constraint items_health_check check (health in ('On Track', 'At Risk', 'Delayed', 'Blocked')),
  add constraint items_date_precision_check check (date_precision in ('Day', 'Month', 'Quarter')),
  add constraint items_confidence_check check (confidence in ('High', 'Medium', 'Low')),
  add constraint items_horizon_check check (horizon in ('Now', 'Next', 'Later')),
  add constraint items_focus_area_check check (focus_area in ('Formats', 'Demand/Optimisation', 'Publishers')),
  add constraint items_decision_check check (decision in ('Go', 'Hold', 'Kill', 'Not yet decided'));

-- ---------------------------------------------------------------------------
-- 3. Every other field that ships in phase 1, as typed columns
-- ---------------------------------------------------------------------------
alter table public.items
  add column roadmap_category text check (roadmap_category in ('New big bets', 'Grow customer revenues', 'Protect customer revenues', 'Operational efficiency', 'Close the gap with competitors')),
  add column initiative_phase text check (initiative_phase in ('Discover', 'Define', 'Build', 'Beta-test', 'Experiment', 'Roll-out', 'Completed', 'Sunset')),
  add column change_type text check (change_type in ('New feature', 'Improvement to existing feature')),
  add column hypothesis text check (char_length(hypothesis) <= 8000),
  add column sponsor uuid,
  add column request_origin text check (request_origin in ('Customer', 'Sales', 'Leadership', 'Product analysis', 'Partner / vendor', 'Competitor move')),
  add column customers_requesting int check (customers_requesting >= 0),
  add column engineering_manager uuid,
  add column designer uuid,
  add column analyst uuid,
  add column business_manager uuid,
  add column kr_metric text check (char_length(kr_metric) <= 2000),
  add column kr_start numeric,
  add column kr_target numeric,
  add column value_type text check (value_type in ('Incremental revenue', 'Defend existing revenue', 'Save money / operational efficiency')),
  add column value_basis text check (value_basis in ('Measured', 'Estimate (basis stated)', 'Partner claim', 'Not stated')),
  add column time_to_first_revenue_months numeric check (time_to_first_revenue_months >= 0),
  add column estimate_low_weeks numeric check (estimate_low_weeks >= 0),
  add column estimate_high_weeks numeric check (estimate_high_weeks >= 0),
  add column cost_of_not_doing text check (char_length(cost_of_not_doing) <= 2000),
  add column dependencies_blockers text check (char_length(dependencies_blockers) <= 2000),
  add column decided_by text check (char_length(decided_by) <= 200),
  add column decision_date date,
  add column next_review_date date,
  add column g2m_date_actual date,
  add column start_discovery date,
  add column start_definition date,
  add column start_building date,
  add column start_beta date,
  add column start_experiment date,
  add column start_rollout date,
  add column last_edited_at timestamptz,
  add column audience text check (audience in ('Publishers', 'Demand partners', 'Brands and agencies', 'Internal', 'Mixed')),
  add column target_customers int check (target_customers >= 0),
  add column gtm_enablement_notes text check (char_length(gtm_enablement_notes) <= 2000),
  add column source text check (char_length(source) <= 2000),
  add column planned_start date,
  add column kr_unit text check (kr_unit in ('%', 'EUR', 'count', 'days', 'other')),
  add column kr_direction text check (kr_direction in ('Increase', 'Decrease')),
  add column estimate_basis text check (estimate_basis in ('Engineering-sized', 'PM estimate', 'Rough guess', 'Not stated')),
  add column visibility text not null default 'Internal only' check (visibility in ('Internal only', 'Shareable')),
  add column last_reviewed_at date,
  add column last_edited_by uuid references auth.users (id) on delete set null,
  add column phase_changed_at timestamptz,
  add column ai_draft boolean not null default false,
  add column archived boolean not null default false,
  add constraint items_estimate_range check (estimate_low_weeks is null or estimate_high_weeks is null or estimate_high_weeks >= estimate_low_weeks);

-- people fields point at tenant members of the same tenant
alter table public.items
  add constraint items_sponsor_fk foreign key (tenant_id, sponsor) references public.tenant_members (tenant_id, user_id) on delete set null (sponsor),
  add constraint items_engineering_manager_fk foreign key (tenant_id, engineering_manager) references public.tenant_members (tenant_id, user_id) on delete set null (engineering_manager),
  add constraint items_designer_fk foreign key (tenant_id, designer) references public.tenant_members (tenant_id, user_id) on delete set null (designer),
  add constraint items_analyst_fk foreign key (tenant_id, analyst) references public.tenant_members (tenant_id, user_id) on delete set null (analyst),
  add constraint items_business_manager_fk foreign key (tenant_id, business_manager) references public.tenant_members (tenant_id, user_id) on delete set null (business_manager);

-- ---------------------------------------------------------------------------
-- 4. Related tables for multi-value fields: tags (also target scope, live scope, segments),
--    links (artifacts), files (screenshots) and item relations (depends on, related to)
-- ---------------------------------------------------------------------------
create table public.item_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  kind text not null check (kind in ('tag', 'target_scope', 'live_scope', 'segment')),
  value text not null check (char_length(btrim(value)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  unique (item_id, kind, value),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index item_tags_item_idx on public.item_tags (tenant_id, item_id);

create table public.item_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  label text not null default '' check (char_length(label) <= 200),
  url text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index item_links_item_idx on public.item_links (tenant_id, item_id);

create table public.item_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  kind text not null default 'screenshot' check (kind in ('screenshot')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  storage_path text not null check (char_length(storage_path) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index item_files_item_idx on public.item_files (tenant_id, item_id);

create table public.item_relations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  related_item_id uuid not null,
  kind text not null check (kind in ('depends_on', 'related_to')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  check (item_id <> related_item_id),
  unique (item_id, related_item_id, kind),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, related_item_id) references public.items (tenant_id, id) on delete cascade
);
create index item_relations_item_idx on public.item_relations (tenant_id, item_id);

-- segments moved from an array column to item_tags
insert into public.item_tags (tenant_id, item_id, kind, value)
select i.tenant_id, i.id, 'segment', btrim(s)
  from public.items i, unnest(i.target_segments) as s
 where btrim(s) <> ''
on conflict do nothing;
alter table public.items drop column target_segments;

-- ---------------------------------------------------------------------------
-- 5. Item behaviour that referred to renamed columns, and the system-set fields
-- ---------------------------------------------------------------------------
create or replace function public.items_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into pv_internal.item_counters (tenant_id, last_number) values (new.tenant_id, 1)
  on conflict (tenant_id) do update set last_number = pv_internal.item_counters.last_number + 1
  returning last_number into n;
  -- lpad() truncates, so numbers above 99 are not padded (0008 gave the 100th item the code R-10)
  new.item_code := 'R-' || case when n < 100 then lpad(n::text, 2, '0') else n::text end;
  select coalesce(max(i.stack_rank), 0) + 1 into new.stack_rank
    from public.items i
   where i.tenant_id = new.tenant_id and i.cycle_id is not distinct from new.cycle_id;
  return new;
end $$;

create or replace function public.items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_blocked boolean;
begin
  v_blocked := public.write_source() = 'Claude MCP'
    or exists (
      select 1 from public.tenant_members m
       where m.tenant_id = new.tenant_id and m.user_id = auth.uid() and m.is_service_account
    );
  if v_blocked then
    if tg_op = 'INSERT' then
      if new.value_12m is not null or new.decision is not null then
        raise exception 'Claude and service accounts cannot set Value or Decision' using errcode = 'PV004';
      end if;
    elsif new.value_12m is distinct from old.value_12m
       or new.decision is distinct from old.decision
       or (new.stack_rank is distinct from old.stack_rank
           and coalesce(current_setting('pv.rank_internal', true), '') <> 'on') then
      raise exception 'Claude and service accounts cannot set Stack Rank, Value or Decision' using errcode = 'PV004';
    end if;
  end if;
  return new;
end $$;

-- System-set fields: who and when last edited; when the phase changed; first date each phase was entered.
-- Re-ranking other items (a side effect of move_item) does not count as an edit of them.
create function public.items_system_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or coalesce(current_setting('pv.rank_internal', true), '') <> 'on' then
    new.last_edited_at := now();
    new.last_edited_by := auth.uid();
  end if;
  if (tg_op = 'INSERT' and new.initiative_phase is not null)
     or (tg_op = 'UPDATE' and new.initiative_phase is distinct from old.initiative_phase) then
    new.phase_changed_at := now();
    if new.initiative_phase = 'Discover' then new.start_discovery := coalesce(new.start_discovery, current_date);
    elsif new.initiative_phase = 'Define' then new.start_definition := coalesce(new.start_definition, current_date);
    elsif new.initiative_phase = 'Build' then new.start_building := coalesce(new.start_building, current_date);
    elsif new.initiative_phase = 'Beta-test' then new.start_beta := coalesce(new.start_beta, current_date);
    elsif new.initiative_phase = 'Experiment' then new.start_experiment := coalesce(new.start_experiment, current_date);
    elsif new.initiative_phase = 'Roll-out' then new.start_rollout := coalesce(new.start_rollout, current_date);
    end if;
  end if;
  return new;
end $$;
create trigger items_d_system before insert or update on public.items
  for each row execute function public.items_system_fields();

-- ---------------------------------------------------------------------------
-- 6. Triggers, RLS and grants for the new tables (fast policy pattern from spike S7)
-- ---------------------------------------------------------------------------
create trigger item_tags_meta before insert or update on public.item_tags for each row execute function public.set_write_meta();
create trigger item_tags_audit after insert or update or delete on public.item_tags for each row execute function public.audit_row();
create trigger item_links_meta before insert or update on public.item_links for each row execute function public.set_write_meta();
create trigger item_links_audit after insert or update or delete on public.item_links for each row execute function public.audit_row();
create trigger item_files_meta before insert or update on public.item_files for each row execute function public.set_write_meta();
create trigger item_files_audit after insert or update or delete on public.item_files for each row execute function public.audit_row();
create trigger item_relations_meta before insert or update on public.item_relations for each row execute function public.set_write_meta();
create trigger item_relations_audit after insert or update or delete on public.item_relations for each row execute function public.audit_row();

alter table public.item_tags enable row level security;
alter table public.item_links enable row level security;
alter table public.item_files enable row level security;
alter table public.item_relations enable row level security;

create policy item_tags_select on public.item_tags for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_tags_insert on public.item_tags for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_tags_delete on public.item_tags for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy item_links_select on public.item_links for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_links_insert on public.item_links for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_links_update on public.item_links for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_links_delete on public.item_links for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy item_files_select on public.item_files for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_files_insert on public.item_files for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_files_update on public.item_files for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_files_delete on public.item_files for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy item_relations_select on public.item_relations for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_relations_insert on public.item_relations for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_relations_delete on public.item_relations for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.item_tags, public.item_links, public.item_files, public.item_relations from public, anon, authenticated;
grant select on public.item_tags, public.item_links, public.item_files, public.item_relations to authenticated;
grant insert (id, tenant_id, item_id, kind, value) on public.item_tags to authenticated;
grant delete on public.item_tags to authenticated;
grant insert (id, tenant_id, item_id, label, url) on public.item_links to authenticated;
grant update (label, url) on public.item_links to authenticated;
grant delete on public.item_links to authenticated;
grant insert (id, tenant_id, item_id, kind, name, storage_path) on public.item_files to authenticated;
grant update (name) on public.item_files to authenticated;
grant delete on public.item_files to authenticated;
grant insert (id, tenant_id, item_id, related_item_id, kind) on public.item_relations to authenticated;
grant delete on public.item_relations to authenticated;

-- items: people may write exactly the fields the dictionary marks "Editable" (stack rank only through move_item);
-- computed, system-set and GitHub-driven (locked) columns stay out of reach of signed-in users.
revoke insert, update on public.items from authenticated;
grant insert (id, tenant_id, cycle_id, roadmap_category, initiative_phase, theme, initiative_name, focus_area, change_type, hypothesis, sponsor, request_origin, customers_requesting, product_manager, engineering_manager, designer, analyst, business_manager, kr_metric, kr_start, kr_target, value_type, value_12m, value_basis, time_to_first_revenue_months, confidence, effort, moscow, estimate_low_weeks, estimate_high_weeks, cost_of_not_doing, dependencies_blockers, decision, decided_by, decision_date, next_review_date, start_date, g2m_date_est, g2m_date_actual, audience, target_customers, gtm_enablement_notes, source, summary, health, horizon, planned_start, kr_unit, kr_direction, estimate_basis, visibility, last_reviewed_at, archived, home_project_id, value_proposition, date_precision, effort_by_skill) on public.items to authenticated;
grant update (roadmap_category, initiative_phase, theme, initiative_name, focus_area, change_type, hypothesis, sponsor, request_origin, customers_requesting, product_manager, engineering_manager, designer, analyst, business_manager, kr_metric, kr_start, kr_target, value_type, value_12m, value_basis, time_to_first_revenue_months, confidence, effort, moscow, estimate_low_weeks, estimate_high_weeks, cost_of_not_doing, dependencies_blockers, decision, decided_by, decision_date, next_review_date, start_date, g2m_date_est, g2m_date_actual, audience, target_customers, gtm_enablement_notes, source, summary, health, horizon, planned_start, kr_unit, kr_direction, estimate_basis, visibility, last_reviewed_at, archived, home_project_id, value_proposition, date_precision, effort_by_skill) on public.items to authenticated;

revoke all on function public.items_system_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Computed fields: one view, one row per item, security_invoker so RLS of items applies.
--    Fields whose inputs arrive in later phases return null until then.
-- ---------------------------------------------------------------------------
create view public.items_computed with (security_invoker = true) as
select
  s.id, s.tenant_id,
  s.value_weighted,
  round(s.value_weighted / nullif(s.estimate_high_weeks, 0), 2) as value_weighted_per_build_week,
  case when s.g2m_date_est is null then null
       else 'Q' || extract(quarter from s.g2m_date_est)::int || ' ' || extract(year from s.g2m_date_est)::int end as g2m_quarter,
  null::numeric as adoption_pct,
  null::numeric as kr_realized_pct,
  s.time_discovery_days,
  s.time_definition_days,
  s.time_building_days,
  s.time_beta_days,
  s.time_experiment_days,
  s.time_rollout_days,
  s.g2m_date_actual - s.start_date as time_to_market_days,
  round(s.time_building_days / 7.0, 1) as actual_build_weeks,
  round(s.time_building_days / 7.0 / nullif(s.estimate_high_weeks, 0) * 100) as build_vs_estimate_high_pct,
  null::int as blocked_days,
  null::int as g2m_slip_days,
  null::int as crowd_rank,
  null::numeric as crowd_score,
  null::numeric as crowd_consensus,
  null::int as crowd_votes,
  s.next_review_date < current_date as review_overdue,
  current_date - s.phase_changed_at::date as days_in_phase,
  current_date - s.created_at::date as item_age_days,
  s.project_rank,
  null::jsonb as fit_by_team,
  null::boolean as ready_for_build,
  null::text as alignment_status,
  null::numeric as value_variance_pct,
  null::int as time_to_first_use_days,
  s.github_issue_url is not null as locked_by_source
from (
  select i.*,
    round(i.value_12m * case i.confidence when 'High' then 0.9 when 'Medium' then 0.6 when 'Low' then 0.3 end, 2) as value_weighted,
    row_number() over (partition by i.tenant_id, i.cycle_id, i.home_project_id order by i.stack_rank)::int as project_rank,
    coalesce(i.start_definition, i.start_building, i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_discovery as time_discovery_days,
    coalesce(i.start_building, i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_definition as time_definition_days,
    coalesce(i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_building as time_building_days,
    coalesce(i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_beta as time_beta_days,
    coalesce(i.start_rollout, i.g2m_date_actual) - i.start_experiment as time_experiment_days,
    i.g2m_date_actual - i.start_rollout as time_rollout_days
  from public.items i
) s;
revoke all on public.items_computed from public, anon, authenticated;
grant select on public.items_computed to authenticated;
