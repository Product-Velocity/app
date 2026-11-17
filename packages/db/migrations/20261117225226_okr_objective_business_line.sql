-- Objective and Business Line: two open text fields on items (Ashu, 2026-11-17, docs/decisions/2026-11-17-objective-and-business-line.md).
-- Open lists like Focus Area (20261028224857): any text up to the limit is accepted, the app suggests the values already in use.
-- The two fields are independent of each other. Nothing is seeded. Never synced to a tracker (the app's NEVER_SYNCED list).
-- Replaces public.copy_items_to_project as it stands after 20261105165113 (item_attachments); only the two new columns are added to the copy.
-- No other open branch replaces it (checked 2026-11-17).
alter table public.items add column okr_objective text check (char_length(okr_objective) <= 120);
alter table public.items add column business_line text check (char_length(business_line) <= 120);
grant insert (okr_objective, business_line) on public.items to authenticated;
grant update (okr_objective, business_line) on public.items to authenticated;

CREATE OR REPLACE FUNCTION public.copy_items_to_project(p_ids uuid[], p_project uuid)
 RETURNS TABLE(id uuid, ok boolean, reason text, new_id uuid, new_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  s public.items%rowtype;
  v_id uuid;
  v_new uuid;
  v_code text;
begin
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'Up to 200 initiatives at a time.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  select p.tenant_id into v_tenant from public.projects p where p.id = p_project;
  if v_tenant is null or v_tenant <> all (array (select public.my_editor_tenant_ids())) then
    raise exception 'You cannot add initiatives to that project.' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    select * into s from public.items i where i.id = v_id and i.tenant_id = v_tenant and i.deleted_at is null;
    if not found then return query select v_id, false, 'That initiative does not exist or is in another workspace.'::text, null::uuid, null::text; continue; end if;
    begin
      insert into public.items (tenant_id, home_project_id, source, roadmap_category, initiative_phase, theme, initiative_name, focus_area, change_type, hypothesis,
        sponsor, request_origin, customers_requesting, owner_user_id, engineering_manager, designer, analyst, business_manager, kr_metric, kr_start, kr_target,
        value_type, value_12m, value_basis, time_to_first_revenue_months, confidence, effort, moscow, estimate_low_weeks, estimate_high_weeks, cost_of_not_doing,
        dependencies_blockers, next_review_date, start_date, end_date, g2m_date_actual, audience, target_customers, gtm_enablement_notes, summary, health, horizon,
        planned_start, kr_unit, kr_direction, estimate_basis, visibility, value_proposition, date_precision, effort_by_skill, okr_objective, business_line)
      values (v_tenant, p_project, 'Copy of ' || s.item_code, s.roadmap_category, s.initiative_phase, s.theme, s.initiative_name, s.focus_area, s.change_type, s.hypothesis,
        s.sponsor, s.request_origin, s.customers_requesting, s.owner_user_id, s.engineering_manager, s.designer, s.analyst, s.business_manager, s.kr_metric, s.kr_start, s.kr_target,
        s.value_type, s.value_12m, s.value_basis, s.time_to_first_revenue_months, s.confidence, s.effort, s.moscow, s.estimate_low_weeks, s.estimate_high_weeks, s.cost_of_not_doing,
        s.dependencies_blockers, s.next_review_date, s.start_date, s.end_date, s.g2m_date_actual, s.audience, s.target_customers, s.gtm_enablement_notes, s.summary, s.health, s.horizon,
        s.planned_start, s.kr_unit, s.kr_direction, s.estimate_basis, s.visibility, s.value_proposition, s.date_precision, s.effort_by_skill, s.okr_objective, s.business_line)
      returning items.id, items.item_code into v_new, v_code;
      insert into public.item_tags (tenant_id, item_id, kind, value) select v_tenant, v_new, t.kind, t.value from public.item_tags t where t.item_id = v_id;
      insert into public.item_attachments (tenant_id, item_id, kind, name, url, shared) select v_tenant, v_new, 'link', l.name, l.url, l.shared from public.item_attachments l where l.kind = 'link' and l.item_id = v_id;
      return query select v_id, true, null::text, v_new, v_code;
    exception when others then
      return query select v_id, false, 'Could not copy this initiative.'::text, null::uuid, null::text;
    end;
  end loop;
end $function$
;
