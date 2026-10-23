-- 0029: copy initiatives into another project (for the Jira mirror test, and for splitting a roadmap).
-- copy_items_to_project(ids, project): for each source initiative of the workspace (creators and admins), creates a NEW initiative in the
--   target project with the same planning fields, tags and links. The copy is a separate initiative: a new code and the next stack rank,
--   source "Copy of R-01" and no tracker link, status, delivery progress, cycle or GitHub-driven value (those belong to the project's own tracker).
--   The decision (Decision, Decided By, Decision Date) is NOT copied: a gate is passed by a person for that initiative, never inherited (rule 3).
-- Up to 200 at a time. Each result row says whether that initiative was copied and the new id and code.
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
create function public.copy_items_to_project(p_ids uuid[], p_project uuid)
returns table (id uuid, ok boolean, reason text, new_id uuid, new_code text)
language plpgsql security definer set search_path = '' as $$
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
        planned_start, kr_unit, kr_direction, estimate_basis, visibility, value_proposition, date_precision, effort_by_skill)
      values (v_tenant, p_project, 'Copy of ' || s.item_code, s.roadmap_category, s.initiative_phase, s.theme, s.initiative_name, s.focus_area, s.change_type, s.hypothesis,
        s.sponsor, s.request_origin, s.customers_requesting, s.owner_user_id, s.engineering_manager, s.designer, s.analyst, s.business_manager, s.kr_metric, s.kr_start, s.kr_target,
        s.value_type, s.value_12m, s.value_basis, s.time_to_first_revenue_months, s.confidence, s.effort, s.moscow, s.estimate_low_weeks, s.estimate_high_weeks, s.cost_of_not_doing,
        s.dependencies_blockers, s.next_review_date, s.start_date, s.end_date, s.g2m_date_actual, s.audience, s.target_customers, s.gtm_enablement_notes, s.summary, s.health, s.horizon,
        s.planned_start, s.kr_unit, s.kr_direction, s.estimate_basis, s.visibility, s.value_proposition, s.date_precision, s.effort_by_skill)
      returning items.id, items.item_code into v_new, v_code;
      insert into public.item_tags (tenant_id, item_id, kind, value) select v_tenant, v_new, t.kind, t.value from public.item_tags t where t.item_id = v_id;
      insert into public.item_links (tenant_id, item_id, label, url) select v_tenant, v_new, l.label, l.url from public.item_links l where l.item_id = v_id;
      return query select v_id, true, null::text, v_new, v_code;
    exception when others then
      return query select v_id, false, 'Could not copy this initiative.'::text, null::uuid, null::text;
    end;
  end loop;
end $$;
revoke all on function public.copy_items_to_project(uuid[], uuid) from public, anon;
grant execute on function public.copy_items_to_project(uuid[], uuid) to authenticated;
