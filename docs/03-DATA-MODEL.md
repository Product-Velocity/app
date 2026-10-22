# Data model (logical)

This replaces the earlier Excel field dictionary (`Roadmap_v3_field_dictionary_proposal.xlsx`), which predates teams, planning cycles, gates, outcomes, reports and breakdown routes. Types are logical; derive SQL. Every table has `id`, `tenant_id`, `created_at`, `updated_at`, `created_by`, `created_via` (UI / API / Claude MCP / GitHub / import / system) and RLS.

## Tenancy and people
- `tenants`, `tenant_members(user_id, role[viewer|commenter|creator|admin|leadership], is_approver, is_service_account)`. Implemented in `packages/db/migrations/0001`. Tenants are created only through `create_tenant(name)` (caller becomes admin). Members, tenant name and audit visibility are admin-managed; viewers see the tenant and its members. `invitations(tenant_id, email, role, is_approver, token_hash, expires_at, accepted_at/by, revoked_at)` (migration 0003): admin-only, one pending invite per email, token stored only as a SHA-256 hash, valid 7 days, single use; `accept_invitation(token)` requires the caller's *confirmed* email to match the invited email and refuses existing members. `tenant_directory(tenant)` (0004) lists a tenant's members with emails for members of that tenant. A tenant can never lose its last admin (0005, applies to everyone including the service role). A service account can never be an approver (check constraint) and a write declared as `Claude MCP` cannot grant Approver (trigger).
- `projects(name, default_repo, github_installation_id, who_breaks_down[product|engineering|either])`; `project_members`.
- `teams(name, project_ids[], github_team, focus_factor, split_maintenance, split_bugs, split_new, week_hours)`; `team_members(team_id, user_id|person_id, hours_per_week, skill_split jsonb)`; `time_off`. Unassigned engineers = `people` with no `team_members` row.
- `saved_scopes(name, project_ids[])`, `saved_views`.

## Item (initiative) — fields
Identity: `key` (R-03), `title`, `summary` (customer-safe), `value_proposition` (customer-safe), `target_segments`, `home_project_id`, `contributing_team_ids`, `group` (theme), `screenshots[]`.
Priority: `stack_rank` (global, per cycle), `previous_rank`, `moscow`, `horizon`, `focus_area`, `value`, `confidence`, `size` (XS..XL), `effort_by_skill` jsonb, `decision` (set by humans only).
Timing: `start`, `end`, `date_precision` (day/month/quarter — customer-safe reports use quarter), `cycle_id`.
Health: `health` (On Track/At Risk/Delayed…, text-labelled), `status` (**GitHub-driven**, read-only), `delivery_progress` (derived), `planned_scope`, `scope_added`.
Spec: `spec_status`, `agent_ready` (bool), `ready_for_build_by`, `ready_for_build_at`; documents in `item_documents`.
Breakdown: `breakdown_route` (traditional|in_between|full_claude), `breakdown_status` (not_started|draft_proposed|awaiting_engineering|complete).
Planning cycle: `planning_status`, `deferred_count`, `deferral_reason`, `added_after_commit`, `candidate_tag` (carry_over|likely_carry_over|deferred|new|backlog).
Gates [R2]: `current_gate`, `gate_status`, `next_gate_due`.
Outcomes [R2]: `outcome_status`, `adoption_pct`, `review_date`, `realised_value`.
Automated: `created_at`, `created_by`, `created_via`, `updated_at`, `status_changed_at`, `github_issue_url`, `last_synced_at`.
Never synced to GitHub: value, confidence, customer fields, decision, rationale, outcomes, key results.

## Related entities
- `item_documents(item_id, kind[prd|business_req|tech_req|acceptance|prototype|research|other], source[link|file], url|storage_path, version, status[draft|in_review|approved|linked], approved_by)`; `document_versions`.
- `epics`/`tasks` (as `work_items(item_id, parent_id, type, title, github_issue_id, created_by[app|claude|engineer], skill, estimate_pw, state)`).
- `readiness_checks(item_id, criterion, state, evidence)`; `approval_requests`.
- `planning_cycles(name, phases jsonb(dates), status)`, `cycle_items(cycle_id, item_id, rank, tag, included, left_out_reason)`.
- `alignment_sessions(cycle_id, method[top5_duels|coins|ice], groups jsonb, weighting, closes_at, status)`, `alignment_items`, `participants(email_hash, segment, group_id, consent_at)`, `ballots(token_hash, session_id, submitted_at)`, `votes`, `invitations(drafted_by, confirmed_by, sent_at)`. Deletion removes personal data but keeps aggregates.
- R2 alignment: `alignment_dimensions(item_id, dimension[why|what|how|when], state, due)`, `signoffs(dimension_id, stakeholder, response[approve|approve_with_concerns|block], note)`, `stakeholders`, `decision_log`.
- `gate_reviews(item_id, gate, criteria jsonb, decision[go|go_with_conditions|hold|stop], rationale (immutable), decided_by, decided_at)`, `gate_conditions`.
- `outcome_metrics(item_id, name, start, target, unit, source)`, `metric_values(metric_id, value, at, source)`, `outcome_reviews(item_id, at_days, decision, notes)`, `feedback_links`.
- `reports(template, scope, audience_profile, format, params)`, `report_snapshots(report_id, storage_path, generated_by, fields_included, fields_withheld)`, `report_schedules`, `audience_profiles(name, visible_fields[])`.
- `github_links(entity, entity_id, github_node_id, repo, sync_state, last_etag)`, `sync_events` (inbound webhooks, idempotency key), `sync_conflicts`.
- `audit_log(tenant_id, entity, entity_id, field, old, new, actor_id, via, at)` — append-only (update, delete and truncate are rejected even for the service role); one row per changed field, written by triggers; readable by tenant admins only. `via` is taken from the transaction setting `app.via` (UI / API / Claude MCP / GitHub webhook / import / system), which only server code sets; if unset it is `API` for signed-in users and `system` otherwise.
- `ai_usage(tenant_id, user_id, feature, tokens_in, tokens_out, at)` — drives allowances and token packs.
- `claude_connections(user_id, last_used_at)`.

## Integrity rules
- `stack_rank` unique per (cycle, scope); changing it re-numbers in one transaction and writes audit rows.
- `status`, `delivery_progress` writable only by the sync engine.
- `decision`, `value`, `stack_rank` not writable by Claude/service identities (enforce in policy, not just UI).
- `gate_reviews` rows are append-only; rationale immutable.
- Audience-profile filtering is applied server-side when building report data, never in the template.
