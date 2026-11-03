import { FIELDS, FIELD_BY_KEY } from "@pv/domain";
import type { CatalogKind } from "./catalog";

// The default mapping of Product Velocity fields to tracker fields, and the slots a person can change (decision 2026-11-03-tracker-field-config).
// EVERYTHING here is derived from what the sync code does today (the defaults are pinned against the payload builders by slots.test.ts), and
// the closed list of slots is the only thing a saved configuration can name: a field that is not a slot can not be mapped, whatever is stored.

export type Tracker = "github" | "jira";
/** to_tracker: sent after a confirmed Sync. two_way: compared three ways (Received, Conflicts, To send). from_tracker: read, read-only in the app (rule 6). not_synced: no code path. never: commercial (rule 2). */
export type Direction = "to_tracker" | "two_way" | "from_tracker" | "not_synced" | "never";

/**
 * Commercial fields (CLAUDE.md rule 2): value, confidence, customers (names and requests), decisions and rationale, key results, outcomes. They are
 * NEVER mappable or sendable to GitHub or Jira. A row of this kind is shown as "Never synced" and can not be edited; no slot may name one of them
 * (slots.test.ts) and the outbound allowlists exclude them (allowlist tests).
 */
export const NEVER_SYNCED: ReadonlySet<string> = new Set([
  "value_type", "value_12m", "value_basis", "value_weighted", "value_weighted_per_build_week", "time_to_first_revenue_months", "confidence",
  "customers_requesting", "target_customers", "customers_live", "adoption_pct",
  "decision", "decided_by", "decision_date", "cost_of_not_doing",
  "kr_metric", "kr_start", "kr_target", "kr_unit", "kr_direction", "realized_kr_value", "kr_realized_pct", "realized_per_year", "measured_period",
  "outcome_verdict", "outcome_status", "outcome_review_date", "value_variance_pct", "learning", "support_hours_saved_month", "retention_pct", "time_to_first_use_days",
  "visibility",
]);

/** Fields a tracker fills in the app. They are read-only there (rule 6) and are only ever mapped in the tracker-to-Product-Velocity direction. */
export const FROM_TRACKER: Record<Tracker, ReadonlyMap<string, string>> = {
  github: new Map([
    ["status", "Issue state (open, closed, reason) of the linked issues: Build Status"],
    ["gh_state", "State of the tracking issue"], ["issues_total", "Sub-issues of the tracking issue"], ["issues_closed", "Closed sub-issues"], ["delivery_progress_pct", "Closed of total sub-issues"],
    ["open_prs", "Linked pull requests, open"], ["merged_prs", "Linked pull requests, merged"], ["gh_last_activity", "Latest activity on the issues"],
    ["blocked_issues", "Sub-issues labelled blocked"], ["stale_issues", "Open sub-issues without recent activity"], ["latest_release", "Newest release of the repositories"],
    ["ci_status", "Checks on the default branch"], ["repositories", "Repositories of the linked issues"],
    ["gh_project_status", "Project board: Status field"], ["gh_iteration", "Project board: Iteration field"], ["gh_target_date", "Project board: Due or target date field"],
  ]),
  jira: new Map([
    ["status", "Issue status category (to do, in progress, done): Build Status"],
    ["issues_total", "Children and sub-tasks of the issue"], ["issues_closed", "Children and sub-tasks in a done status category"], ["delivery_progress_pct", "Done of total children"],
  ]),
};

/** Fields compared three ways (Received, Conflicts, To send). */
export const TWO_WAY: Record<Tracker, ReadonlyMap<string, string>> = {
  github: new Map([["initiative_name", "Issue title (after the item code)"], ["summary", "Managed block, ## Summary"], ["description", "Managed block, ## Description"], ["hypothesis", "Managed block, ## Hypothesis"], ["assignees", "Issue assignees (people matched by GitHub username)"]]),
  jira: new Map([["initiative_name", "Summary"], ["description", "Description (Atlassian Document Format)"]]),
};

export type SlotKind = "fixed" | "toggle" | "field";
export type Slot = {
  id: string;
  tracker: Tracker;
  /** The Product Velocity field this slot carries (dictionary key). */
  pvKey: string;
  kind: SlotKind;
  direction: "to_tracker" | "two_way";
  /** What the default sends it to, in words. */
  defaultTarget: string;
  /** For "fixed": why it can not change. */
  fixedReason?: string;
  /** For "field": the kinds of tracker field it can be pointed at, the field the default uses (a catalog id), and whether custom ids only are allowed. */
  accepts?: readonly CatalogKind[];
  defaultFieldId?: string;
  idPattern?: RegExp;
  /** Where a saved choice lives: the new table, the existing Jira field map, or the board mapping of GitHub (saved by the Project boards card). */
  store: "config" | "jira_field_map" | "github_board";
};

const CUSTOM = /^customfield_\d{1,9}$/;
const label = (id: string, pvKey: string, tracker: Tracker, defaultTarget: string): Slot => ({ id, tracker, pvKey, kind: "toggle", direction: "to_tracker", defaultTarget, store: "config" });

export const SLOTS: readonly Slot[] = [
  // ---- Jira ----
  { id: "jira.summary", tracker: "jira", pvKey: "initiative_name", kind: "fixed", direction: "two_way", defaultTarget: "Summary", fixedReason: "Jira requires a summary, and the name is compared both ways.", store: "config" },
  { id: "jira.description", tracker: "jira", pvKey: "description", kind: "fixed", direction: "two_way", defaultTarget: "Description (Atlassian Document Format)", fixedReason: "The description is compared both ways, so it always goes along.", store: "config" },
  label("jira.label.moscow", "moscow", "jira", "Label pv:moscow/<value>"),
  label("jira.label.rank", "stack_rank", "jira", "Label pv:rank/<band> (top 10, 25, 50, later; never the number)"),
  label("jira.label.type", "change_type", "jira", "Label pv:type/<value>"),
  label("jira.label.group", "theme", "jira", "Label pv:group/<name>"),
  label("jira.label.project", "home_project", "jira", "Label pv:project/<project>"),
  { id: "jira.priority", tracker: "jira", pvKey: "moscow", kind: "field", direction: "to_tracker", defaultTarget: "Priority (one Jira priority per MoSCoW value; not sent until chosen)", accepts: ["select"], store: "jira_field_map" },
  { id: "jira.startDate", tracker: "jira", pvKey: "planned_start", kind: "field", direction: "to_tracker", defaultTarget: "Start date custom field (not sent until chosen)", accepts: ["date"], idPattern: CUSTOM, store: "jira_field_map" },
  { id: "jira.theme", tracker: "jira", pvKey: "theme", kind: "field", direction: "to_tracker", defaultTarget: "Single-line text custom field (not sent until chosen)", accepts: ["text"], idPattern: CUSTOM, store: "jira_field_map" },
  { id: "jira.dueDate", tracker: "jira", pvKey: "g2m_date_est", kind: "field", direction: "to_tracker", defaultTarget: "Due date (duedate)", accepts: ["date"], defaultFieldId: "duedate", idPattern: /^(duedate|customfield_\d{1,9})$/, store: "config" },
  // ---- GitHub ----
  { id: "github.title", tracker: "github", pvKey: "initiative_name", kind: "fixed", direction: "two_way", defaultTarget: "Issue title", fixedReason: "An issue needs a title, and the name is compared both ways.", store: "config" },
  { id: "github.code", tracker: "github", pvKey: "item_code", kind: "fixed", direction: "to_tracker", defaultTarget: "Title prefix and the backlink in the managed block", fixedReason: "The code identifies the initiative on the issue.", store: "config" },
  { id: "github.body.summary", tracker: "github", pvKey: "summary", kind: "fixed", direction: "two_way", defaultTarget: "Managed block, ## Summary", fixedReason: "The block's texts are compared both ways, so the sections stay as they are.", store: "config" },
  { id: "github.body.description", tracker: "github", pvKey: "description", kind: "fixed", direction: "two_way", defaultTarget: "Managed block, ## Description", fixedReason: "The block's texts are compared both ways, so the sections stay as they are.", store: "config" },
  { id: "github.body.hypothesis", tracker: "github", pvKey: "hypothesis", kind: "fixed", direction: "two_way", defaultTarget: "Managed block, ## Hypothesis", fixedReason: "The block's texts are compared both ways, so the sections stay as they are.", store: "config" },
  label("github.body.artifacts", "artifacts", "github", "Managed block, ## Artifacts (links)"),
  label("github.body.files", "screenshots", "github", "Managed block, ## Files (share links, private repositories only)"),
  label("github.label.moscow", "moscow", "github", "Label pv:moscow/<value>"),
  label("github.label.rank", "stack_rank", "github", "Label pv:rank/<band> (top 10, 25, 50, later; never the number)"),
  label("github.label.type", "change_type", "github", "Label pv:type/<value>"),
  label("github.label.group", "theme", "github", "Label pv:group/<name>"),
  label("github.label.project", "home_project", "github", "Label pv:project/<project>"),
  label("github.milestone", "g2m_date_est", "github", "Milestone “YYYY Qn” (the quarter of the G2M date)"),
  label("github.issueType", "change_type", "github", "Organisation issue type (Feature or Improvement), when the organisation has it"),
  { id: "github.board.priority", tracker: "github", pvKey: "moscow", kind: "field", direction: "to_tracker", defaultTarget: "Project board: the field named Priority (P0, P1, P2)", accepts: ["select"], store: "github_board" },
  { id: "github.board.group", tracker: "github", pvKey: "theme", kind: "field", direction: "to_tracker", defaultTarget: "Project board: the field named Initiative, Group or Theme", accepts: ["select", "text"], store: "github_board" },
  { id: "github.board.dueDate", tracker: "github", pvKey: "g2m_date_est", kind: "field", direction: "to_tracker", defaultTarget: "Project board: the field named Due date or Target date", accepts: ["date"], store: "github_board" },
  { id: "github.board.size", tracker: "github", pvKey: "effort", kind: "field", direction: "to_tracker", defaultTarget: "Project board: the field named Size or Effort", accepts: ["select"], store: "github_board" },
];

export const SLOT_BY_ID: ReadonlyMap<string, Slot> = new Map(SLOTS.map((s) => [s.id, s]));
export const slotsFor = (t: Tracker) => SLOTS.filter((s) => s.tracker === t);

export type MappingRow = {
  key: string;
  label: string;
  direction: Direction;
  /** The default tracker field, in words. */
  target: string;
  /** Why a row can not be edited (never, read-only, not synced, fixed). Null when it can. */
  reason: string | null;
  slot: Slot | null;
};

/** The whole default list for one tracker: one row per slot, and one row for each of the 170 fields that has none. Same order as the dictionary. */
export function mappingRows(tracker: Tracker): MappingRow[] {
  const mine = slotsFor(tracker);
  const rows: MappingRow[] = [];
  for (const f of FIELDS) {
    const slots = mine.filter((s) => s.pvKey === f.key);
    if (NEVER_SYNCED.has(f.key)) { rows.push({ key: f.key, label: f.name, direction: "never", target: "Never synced", reason: "Commercial: value, confidence, customers, decisions, key results and outcomes never leave Product Velocity.", slot: null }); continue; }
    if (slots.length > 0) {
      for (const s of slots) rows.push({ key: f.key, label: f.name, direction: s.direction, target: s.defaultTarget, reason: s.kind === "fixed" ? (s.fixedReason ?? "Fixed.") : null, slot: s });
      continue;
    }
    const two = TWO_WAY[tracker].get(f.key);
    if (two) { rows.push({ key: f.key, label: f.name, direction: "two_way", target: two, reason: "Compared both ways; not re-pointable.", slot: null }); continue; }
    const from = FROM_TRACKER[tracker].get(f.key);
    if (from) { rows.push({ key: f.key, label: f.name, direction: "from_tracker", target: from, reason: "Filled by the tracker and read-only in the app. It is not re-pointable.", slot: null }); continue; }
    rows.push({ key: f.key, label: f.name, direction: "not_synced", target: "Not synced", reason: "No sync path for this field.", slot: null });
  }
  return rows;
}

/** Every dictionary key a slot or a classification names must exist (a typo here would silently drop a row). */
export const knownKey = (k: string) => k in FIELD_BY_KEY;
