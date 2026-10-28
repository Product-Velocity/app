-- R-114: G2M Quarter becomes Planned Quarter, a stored field a person sets (calendar quarter and year, e.g. 'Q3 2027').
-- The key stays g2m_quarter. It was calculated from G2M Date (est) (end_date) in the view items_computed; this migration
-- (1) adds the column, (2) stores each initiative's current calculated value once, so no initiative loses its quarter,
-- (3) removes the calculated column from the view, so the value no longer recalculates when dates change.
-- Independent of the G2M date from now on; the quarter is never written to GitHub (the milestone still comes from G2M Date (est)).

alter table public.items add column g2m_quarter text;

update public.items
   set g2m_quarter = 'Q' || extract(quarter from end_date)::int || ' ' || extract(year from end_date)::int
 where end_date is not null;

alter table public.items add constraint items_g2m_quarter_check check (g2m_quarter ~ '^Q[1-4] [0-9]{4}$');

-- planning by quarter filters and groups on this column
create index items_tenant_g2m_quarter_idx on public.items (tenant_id, g2m_quarter);

-- same columns as before, minus g2m_quarter (create or replace cannot drop a column)
drop view public.items_computed;
create view public.items_computed with (security_invoker = true) as
select
  s.id, s.tenant_id,
  s.value_weighted,
  round(s.value_weighted / nullif(s.estimate_high_weeks, 0), 2) as value_weighted_per_build_week,
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

-- people and Claude may write the column like any other planning field (not person-only, so items_guard lets Claude set it;
-- the change is flagged as an AI draft change and audited with its source by the existing triggers)
grant insert (g2m_quarter) on public.items to authenticated;
grant update (g2m_quarter) on public.items to authenticated;
