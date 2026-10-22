# Items schema versus the field dictionary (issue #19)

Spec: `docs/reference/item-fields.csv` (165 fields). Before: migration 0008 (36 item columns). After: migration 0009. Check any time with `pnpm test` (registry versus CSV) and `pnpm db:test` (schema versus registry).

## What was wrong in 0008, and what 0009 did

| Gap | Fields | Fix in 0009 |
|---|---|---|
| Renamed to the dictionary key | `key`→`item_code`, `title`→`initiative_name`, `value`→`value_12m`, `size`→`effort`, `delivery_progress`→`delivery_progress_pct` | `rename column` (data, grants, audit history keep working; old audit rows keep the old field name) |
| Wrong type | `confidence` was a 0–100 number; the dictionary has High / Medium / Low | converted: 70+ High, 40–69 Medium, below 40 Low |
| Wrong values | `moscow` (lower case), `health` (no Blocked), `date_precision` (lower case), `horizon`, `focus_area`, `decision` (free text) | stored exactly as the dictionary spells them and constrained by a check; free text that did not match became empty |
| Wrong storage | `target_segments` was an array column; the dictionary says tags in a related table | moved to `item_tags` (kind `segment`), column dropped |
| Missing, phase 1 | 46 columns: roadmap_category, initiative_phase, change_type, hypothesis, sponsor, request_origin, customers_requesting, engineering_manager, designer, analyst, business_manager, kr_metric, kr_start, kr_target, kr_unit, kr_direction, value_type, value_basis, time_to_first_revenue_months, estimate_low_weeks, estimate_high_weeks, estimate_basis, cost_of_not_doing, dependencies_blockers, decided_by, decision_date, next_review_date, last_reviewed_at, g2m_date_actual, planned_start, audience, target_customers, gtm_enablement_notes, source, visibility, archived, and the system-set last_edited_at, last_edited_by, phase_changed_at, start_discovery, start_definition, start_building, start_beta, start_experiment, start_rollout, ai_draft | typed columns with checks; people fields are composite foreign keys to `tenant_members` (no cross-tenant references) |
| Missing, related tables (phase 1) | tags, target_scope, live_scope (and segments) → `item_tags`; artifacts → `item_links`; screenshots → `item_files`; depends_on, related_to → `item_relations` | four new tables: RLS (fast pattern), audit, column grants, in the RLS probe list; `contributing_teams` already is `item_teams`, `home_project` is the `home_project_id` foreign key |
| Computed fields | 30 stored nowhere | view `items_computed` (security invoker, so RLS of `items` applies); fields whose inputs arrive later return null |
| Bug found on the way | `lpad(n, 2, '0')` truncates: the 100th item of a tenant got the code `R-10` and collided | item codes above R-99 are no longer padded (R-100, R-101, ...) |

## Column names that differ from the dictionary key (on purpose)
`owner_user_id` holds the dictionary field `product_manager` (a user id, a member of the tenant), `end_date` holds `g2m_date_est`, `home_project_id` holds `home_project`. The registry maps key to column; the label people see always comes from the dictionary, never from the column name.

## Kept on purpose, not in the dictionary
`cycle_id` (planning cycles, phase 5), `github_issue_url` and `last_synced_at` (sync bookkeeping; replaced by `github_links` in phase 3), `updated_at`, `created_via` as write provenance (see decision below).

## Fields that arrive later (registered as grid columns, "arrives in phase N", no data column yet)
- Phase 2: comments · Phase 3: 22 GitHub-synced fields (status exists already, locked) · Phase 4: 7 · Phase 5: 6 · Phase 7: 14 · Phase 8: 4.
- Computed fields of later phases are in the view and return null until their inputs exist.

## Editing modes (sheet "Grid columns and views")
Editable 92, computed 35, system 23, locked by GitHub 15. Signed-in users can write exactly the phase-1 editable columns (database grants, tested); stack rank moves only through `move_item`. In the grid, tags, links, files, relations and the effort-by-skill structure are shown as text and edited in the item panel (phase 2); everything else editable is edited in the cell.
