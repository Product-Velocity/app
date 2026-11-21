-- Issue #565, slice 2 (PV skills): six more kinds of written document, one per skill that saves its own kind (pre-mortem, one-pager,
-- success metrics, go-to-market, experiment, user stories). Forward-only: the kind check of item_documents gets six more values.
-- No data is touched and no function is replaced.

alter table public.item_documents drop constraint item_documents_kind_check;
alter table public.item_documents add constraint item_documents_kind_check
  check (kind in ('prd', 'discovery', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'design', 'customer_evidence', 'meeting_notes',
                  'premortem', 'one_pager', 'success_metrics', 'go_to_market', 'experiment', 'user_stories', 'other'));
