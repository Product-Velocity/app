-- issue #244: a discovery document is its own kind of document on an initiative (Ashu's decision, docs/24-CLAUDE-DISCOVERY-FLOW.md).
-- Forward-only: the kind check of item_documents (0055) gets one more value. No data is touched and no function is replaced.

alter table public.item_documents drop constraint item_documents_kind_check;
alter table public.item_documents add constraint item_documents_kind_check
  check (kind in ('prd', 'discovery', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'other'));
