-- Issue #565 (PV skills, wave 2): one more kind of written document for each new skill that saves its own kind.
-- On an initiative (item_documents): split_plan, assumption_map, sunset_plan, stakeholder_map, readiness_review.
-- Forward-only: one kind check gets more values. No data is touched and no function is replaced.

alter table public.item_documents drop constraint item_documents_kind_check;
alter table public.item_documents add constraint item_documents_kind_check
  check (kind in ('prd', 'discovery', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'design', 'customer_evidence', 'meeting_notes',
                  'premortem', 'one_pager', 'success_metrics', 'go_to_market', 'experiment', 'user_stories',
                  'business_case', 'pr_faq', 'opportunity_tree',
                  'gate_brief', 'hypothesis', 'outcome_brief',
                  'split_plan', 'assumption_map', 'sunset_plan', 'stakeholder_map', 'readiness_review', 'other'));
