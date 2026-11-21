-- Issue #565 (PV skills): more kinds of written document, one per skill that saves its own kind.
-- On an initiative (item_documents): business_case, pr_faq, opportunity_tree. In the workspace (workspace_documents): impact_map, market_sizing, canvas.
-- Forward-only: two kind checks get more values. No data is touched and no function is replaced.

alter table public.item_documents drop constraint item_documents_kind_check;
alter table public.item_documents add constraint item_documents_kind_check
  check (kind in ('prd', 'discovery', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'design', 'customer_evidence', 'meeting_notes',
                  'premortem', 'one_pager', 'success_metrics', 'go_to_market', 'experiment', 'user_stories',
                  'business_case', 'pr_faq', 'opportunity_tree', 'other'));

alter table public.workspace_documents drop constraint workspace_documents_kind_check;
alter table public.workspace_documents add constraint workspace_documents_kind_check
  check (kind in ('vision', 'strategy', 'north_star', 'competitive', 'personas', 'weekly_update', 'release_notes', 'quarter_plan',
                  'impact_map', 'market_sizing', 'canvas', 'other'));
