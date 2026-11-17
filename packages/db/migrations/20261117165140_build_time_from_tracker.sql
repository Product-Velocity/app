-- Build time from the tracker's own dates (issue #480, Ashu 2026-11-17: "build dates and statuses ... we should use them, also in the reports on build time/weeks").
-- Building Time (days), Actual Build (weeks) and Build vs Estimate High (%) were worked out from the start of the NEXT phase (Start Beta, ...), which is rarely filled:
-- 3 initiatives had a value in production. With Start Building and the tracker's Build Completed (issue #421) 47 have one. The view takes the build end from the tracker
-- first (GitHub: the ticket closed as completed; Jira: the issue resolved while its status category is done) and keeps the next phase start as the fallback.
-- Only the expression of time_building_days changes: the view keeps the same columns, in the same order and with the same types (create or replace view, no drop).
-- Functions replaced by this migration: none. No DROP statements.
create or replace view public.items_computed with (security_invoker = true) as
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
  case
    when s.current_gate = 'B' and s.gate_status in ('In review', 'Waiting for Approver') then 'Requested'
    when s.ready_for_build_at is not null and s.initiative_phase = 'Build' and s.start_building is null then 'Ready'
    when s.initiative_phase is null or s.initiative_phase in ('Discover', 'Define') then 'Not ready'
  end as ready_for_build,
  null::text as alignment_status,
  null::numeric as value_variance_pct,
  null::int as time_to_first_use_days,
  s.github_issue_url is not null as locked_by_source
from (
  select i.*,
    round(i.value_12m * case i.confidence when 'High' then 0.9 when 'Medium' then 0.6 when 'Low' then 0.3 end, 2) as value_weighted,
    row_number() over (partition by i.tenant_id, i.cycle_id, i.home_project_id order by i.stack_rank)::int as project_rank,
    coalesce(i.start_definition, i.ready_for_build_at::date, i.start_building, i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_discovery as time_discovery_days,
    coalesce(i.ready_for_build_at::date, i.start_building, i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_definition as time_definition_days,
    -- Building Time (issue #480): from Start Building to Build Completed, the tracker's own date (a GitHub ticket closed as completed, else a Jira issue resolved while its
    -- status category is done), so an initiative that is built and not yet in a later phase has a build time; when the tracker has no completion (or it is before the start)
    -- the start of the next phase is the end, as before. Never negative.
    coalesce(
      case when b.build_end is not null and i.start_building is not null and b.build_end::date >= i.start_building then b.build_end::date - i.start_building end,
      coalesce(i.start_beta, i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_building
    ) as time_building_days,
    coalesce(i.start_experiment, i.start_rollout, i.g2m_date_actual) - i.start_beta as time_beta_days,
    coalesce(i.start_rollout, i.g2m_date_actual) - i.start_experiment as time_experiment_days,
    i.g2m_date_actual - i.start_rollout as time_rollout_days
  from public.items i
  left join lateral (
    select coalesce(
      (select l.gh_closed_at from public.item_github_links l where l.tenant_id = i.tenant_id and l.item_id = i.id and l.gh_state = 'closed_completed'),
      (select j.jira_resolved_at from public.item_jira_links j where j.tenant_id = i.tenant_id and j.item_id = i.id and j.jira_status_category = 'done')
    ) as build_end
  ) b on true
) s;
grant select on public.items_computed to authenticated;
