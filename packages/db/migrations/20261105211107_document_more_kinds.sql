-- Issue #325, slice C: three more kinds of written document (design, customer evidence, meeting notes).
-- Forward-only: the kind check of item_documents gets three more values. No data is touched and no function is replaced.

alter table public.item_documents drop constraint item_documents_kind_check;
alter table public.item_documents add constraint item_documents_kind_check
  check (kind in ('prd', 'discovery', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'design', 'customer_evidence', 'meeting_notes', 'other'));
