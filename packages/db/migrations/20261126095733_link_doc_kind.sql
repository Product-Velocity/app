-- Issue #693, slice A: an attachment (a link, later a file) can carry a document kind, the same list as written documents, so that people and assistants
-- know where the latest document of a kind lives (for example a Business case in Confluence). Null means "no kind".
--
-- Forward-only: one nullable column, no data is touched. Rollback: drop the column (nothing else reads it).
-- Functions replaced (rewritten from their current definition, only the shown text changes; the migration stops if the text is not found):
--   mcp_apply (list_add of a link stores doc_kind), mcp_undo_last (a removed link is put back with its kind), copy_items_to_project (a copy keeps the kind).
-- Not replaced: audit_row, set_write_meta, item_activity (they read columns generically).

alter table public.item_attachments
  add column doc_kind text check (doc_kind in ('prd', 'discovery', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'design', 'customer_evidence', 'meeting_notes', 'premortem', 'one_pager', 'success_metrics', 'go_to_market', 'experiment', 'user_stories', 'business_case', 'pr_faq', 'opportunity_tree', 'gate_brief', 'hypothesis', 'outcome_brief', 'split_plan', 'assumption_map', 'sunset_plan', 'stakeholder_map', 'readiness_review', 'other'));

grant insert (doc_kind) on public.item_attachments to authenticated;
grant update (doc_kind) on public.item_attachments to authenticated;

create or replace function pg_temp.rewrite_fn(p_sig text, p_pairs text[]) returns void
language plpgsql as $$
declare d text; i int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  for i in 1 .. array_length(p_pairs, 1) by 2 loop
    if position(p_pairs[i] in d) = 0 then
      raise exception 'rewrite of % failed: text not found: %', p_sig, p_pairs[i];
    end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  end loop;
  execute d;
end $$;

select pg_temp.rewrite_fn('public.mcp_apply(text, jsonb, boolean, uuid, uuid)', array[
  $a$insert into public.item_attachments (tenant_id, item_id, kind, name, url) values (v_tenant, v_item, 'link', coalesce(v_val ->> 'label', ''), v_val ->> 'url');$a$,
  $b$insert into public.item_attachments (tenant_id, item_id, kind, name, url, doc_kind) values (v_tenant, v_item, 'link', coalesce(v_val ->> 'label', ''), v_val ->> 'url', nullif(v_val ->> 'kind', ''));$b$
]);

select pg_temp.rewrite_fn('public.mcp_undo_last(uuid)', array[
  $a$insert into public.item_attachments (id, tenant_id, item_id, kind, name, url) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, 'link', coalesce(v_old ->> 'label', v_old ->> 'name', ''), v_old ->> 'url');$a$,
  $b$insert into public.item_attachments (id, tenant_id, item_id, kind, name, url, doc_kind) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, 'link', coalesce(v_old ->> 'label', v_old ->> 'name', ''), v_old ->> 'url', nullif(v_old ->> 'doc_kind', ''));$b$
]);

select pg_temp.rewrite_fn('public.copy_items_to_project(uuid[], uuid)', array[
  $a$insert into public.item_attachments (tenant_id, item_id, kind, name, url, shared) select v_tenant, v_new, 'link', l.name, l.url, l.shared from public.item_attachments l where l.kind = 'link' and l.item_id = v_id;$a$,
  $b$insert into public.item_attachments (tenant_id, item_id, kind, name, url, shared, doc_kind) select v_tenant, v_new, 'link', l.name, l.url, l.shared, l.doc_kind from public.item_attachments l where l.kind = 'link' and l.item_id = v_id;$b$
]);
