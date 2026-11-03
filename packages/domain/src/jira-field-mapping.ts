// Jira field mapping (docs/16 point 3, issues #69 and #70): which Jira field may be mapped to which Product Velocity field, and in which direction.
// PURE and shared by the settings page and the database check: `jira_set_field_mapping` (migration 20261103120000_jira_field_mappings) enforces
// the same table in SQL, and a database test compares the two over every dictionary field, so they cannot drift apart.
// The 170-field dictionary does not grow: a Jira field maps to an existing PV field or stays unmapped (visible in the catalog, ignored).

import { FIELD_BY_KEY } from "./registry";

export type JiraDirection = "read" | "two_way";
export const JIRA_DIRECTIONS: readonly JiraDirection[] = ["read", "two_way"];

/**
 * How a Jira field's value is shaped, from its schema (the catalog's `kind`). `other` is a value this app has no rule for; `team` and `parent`
 * are objects that used to come back as `other` (spike J2).
 */
export type JiraKind = "text" | "number" | "date" | "datetime" | "select" | "multi-select" | "user" | "users" | "labels" | "sprint" | "link" | "team" | "parent" | "other";
export const JIRA_KINDS: readonly JiraKind[] = ["text", "number", "date", "datetime", "select", "multi-select", "user", "users", "labels", "sprint", "link", "team", "parent", "other"];

export type MappingRefusal =
  | "unknown_pv_field" | "unknown_direction" | "unknown_kind" | "status_people_only" | "tracker_driven" | "commercial" | "private"
  | "not_for_jira" | "jira_unmappable" | "incompatible" | "two_way_not_allowed" | "jira_read_only";
export type MappingCheck = { ok: true } | { ok: false; code: MappingRefusal; reason: string };

/** The Jira side of a pair, as the catalog describes it. */
export type JiraFieldRef = { id: string; custom: boolean; kind: string };

/**
 * Commercial and person-only fields (CLAUDE.md rules 2, 3 and 7): money, confidence, customers, decisions and rationale, key results, outcomes,
 * markets and the rank. They can never be mapped TWO-WAY or OUTBOUND, and this slice also refuses reading them from Jira: a Jira edit must not
 * be able to set Value, Decision or Stack Rank (person-only values). Mirrors the commercial lists of the GitHub and Jira outbound allowlist tests.
 */
export const COMMERCIAL_FIELDS: readonly string[] = [
  "value_type", "value_12m", "value_basis", "value_weighted", "value_weighted_per_build_week", "time_to_first_revenue_months", "confidence",
  "customers_requesting", "target_customers", "customers_live", "cost_of_not_doing",
  "kr_metric", "kr_start", "kr_target", "kr_unit", "kr_direction", "realized_kr_value", "kr_realized_pct", "realized_per_year", "value_variance_pct",
  "decision", "decided_by", "decision_date", "stack_rank", "previous_rank", "project_rank",
  "outcome_status", "outcome_verdict", "outcome_review_date", "learning", "measured_period", "retention_pct", "support_hours_saved_month",
  "adoption_pct", "rollout_pct", "time_to_first_use_days", "target_scope", "live_scope", "target_segments", "gtm_enablement_notes", "request_origin",
];
/** Alignment and crowd results belong to anonymous voters (rule 7): never mapped. */
export const PRIVATE_FIELDS: readonly string[] = ["crowd_rank", "crowd_score", "crowd_consensus", "crowd_votes", "alignment_status", "align_why", "align_what", "align_how", "align_when"];
/** Fed by the tracker, so read only and never two-way (rule 6): Build Status, delivery progress, pull requests and CI. Calculated or system fields cannot be mapped either. */
export const TRACKER_DRIVEN_FIELDS: readonly string[] = [
  "status", "sync_state", "gh_state", "issues_closed", "issues_total", "delivery_progress_pct", "open_prs", "merged_prs", "gh_last_activity", "gh_project_status",
  "gh_iteration", "gh_target_date", "blocked_issues", "stale_issues", "scope_added", "schedule_variance_pp", "latest_release", "ci_status", "repositories",
  "github_links", "planned_scope", "breakdown_route", "breakdown_status", "last_synced", "synced_with", "tracker_ownership",
];

export type JiraTarget = {
  /** A key of the 170-field dictionary. */
  pv: string;
  /** Jira kinds whose value can be read into (and, if allowed, written from) this field. */
  accepts: readonly JiraKind[];
  /** Only fields on the Jira outbound allowlist (`OUTBOUND_JIRA_FIELDS`) may be two-way; a test ties the two lists together. */
  twoWay: boolean;
};

/**
 * The ONLY PV fields a Jira field can map to (a whitelist: everything else is refused, whatever its category). Non-commercial, editable
 * by a person, one value per item, and not driven by a tracker. Initiative Name and Description are always synced and are not mappable.
 */
export const JIRA_TARGETS: readonly JiraTarget[] = [
  { pv: "planned_start", accepts: ["date", "datetime"], twoWay: true },
  { pv: "g2m_date_est", accepts: ["date", "datetime"], twoWay: true },
  { pv: "moscow", accepts: ["select"], twoWay: true },
  { pv: "effort", accepts: ["select"], twoWay: false },
  { pv: "horizon", accepts: ["select"], twoWay: false },
  { pv: "theme", accepts: ["select", "text"], twoWay: false },
  { pv: "focus_area", accepts: ["select", "text"], twoWay: false },
  { pv: "estimate_low_weeks", accepts: ["number"], twoWay: false },
  { pv: "estimate_high_weeks", accepts: ["number"], twoWay: false },
  { pv: "tags", accepts: ["labels", "multi-select"], twoWay: false },
  { pv: "contributing_teams", accepts: ["team", "labels", "multi-select", "select"], twoWay: false },
  { pv: "assignees", accepts: ["user", "users"], twoWay: false },
];
const TARGET_BY_PV = new Map(JIRA_TARGETS.map((t) => [t.pv, t]));
export const JIRA_MAPPABLE_FIELDS: readonly string[] = JIRA_TARGETS.map((t) => t.pv);

/**
 * Jira fields that are never mapped: a status or a resolution (rule 6: Initiative Status is set by people only), fields Jira computes, and the
 * summary and description, which Sync already keeps in step with the initiative's name and description.
 */
export const JIRA_ALWAYS_SYNCED_IDS: readonly string[] = ["summary", "description"];
export const JIRA_UNMAPPABLE_IDS: readonly string[] = [...JIRA_ALWAYS_SYNCED_IDS, "status", "statuscategory", "resolution", "resolutiondate", "issuekey", "id", "key", "issuetype", "project", "lastViewed", "workratio", "progress", "aggregateprogress"];
/** System fields Jira computes or Jira people cannot set through the API the way a custom field is set. */
export const JIRA_READ_ONLY_IDS: readonly string[] = [
  ...JIRA_UNMAPPABLE_IDS, "created", "updated", "creator", "reporter", "comment", "worklog", "votes", "watches", "attachment", "issuelinks", "subtasks", "thumbnail",
  "timetracking", "timespent", "timeestimate", "timeoriginalestimate", "aggregatetimespent", "aggregatetimeestimate", "aggregatetimeoriginalestimate", "environment",
];
/** Jira kinds this app can write back: a single scalar, a choice or labels. Objects (team, parent, sprint) and people are read only. */
const WRITABLE_KINDS: readonly JiraKind[] = ["text", "number", "date", "datetime", "select", "labels"];

const label = (pv: string) => FIELD_BY_KEY[pv]?.name ?? pv;
const fail = (code: MappingRefusal, reason: string): MappingCheck => ({ ok: false, code, reason });

/** Why a PV field is not on the list, in words an admin understands; null when it is on the list. */
export function pvFieldRefusal(pv: string): MappingCheck {
  const def = FIELD_BY_KEY[pv];
  if (!def) return fail("unknown_pv_field", "That is not a Product Velocity field.");
  if (pv === "initiative_status") return fail("status_people_only", "Initiative Status is set by people only; a Jira field can never set it. A closed ticket means the build is complete, not the initiative.");
  if (TRACKER_DRIVEN_FIELDS.includes(pv)) return fail("tracker_driven", `${def.name} comes from the tracker and is read only. It is filled by the sync of the tracker itself, so it cannot be mapped from a Jira field.`);
  if (COMMERCIAL_FIELDS.includes(pv)) return fail("commercial", `${def.name} is a commercial or person-only field. It never leaves Product Velocity for Jira, and a Jira field cannot set it.`);
  if (PRIVATE_FIELDS.includes(pv)) return fail("private", `${def.name} holds anonymous alignment results and is never mapped.`);
  if (!TARGET_BY_PV.has(pv)) {
    if (def.mode !== "editable") return fail("not_for_jira", `${def.name} is ${def.mode === "computed" ? "calculated" : def.mode === "system" ? "set by the system" : "set by a tracker"} and cannot be mapped.`);
    return fail("not_for_jira", `${def.name} is not available for the Jira mapping. The fields Jira can fill are: ${JIRA_TARGETS.map((t) => label(t.pv)).join(", ")}.`);
  }
  return { ok: true };
}

/** The one rule for a pair; the database function applies the same rules (and a test compares them). */
export function validateJiraMapping(jira: JiraFieldRef, pv: string, direction: string): MappingCheck {
  if (direction !== "read" && direction !== "two_way") return fail("unknown_direction", "Choose read only or two-way.");
  if (!(JIRA_KINDS as readonly string[]).includes(jira.kind)) return fail("unknown_kind", "That kind of Jira field is not known.");
  const refused = pvFieldRefusal(pv);
  if (!refused.ok) return refused;
  if (JIRA_ALWAYS_SYNCED_IDS.includes(jira.id)) return fail("jira_unmappable", "The title and description are always synced with the initiative's name and description, so they are not mapped.");
  if (JIRA_UNMAPPABLE_IDS.includes(jira.id)) return fail("jira_unmappable", "A Jira status, resolution or computed field is never mapped. The build status is read from the status category when Sync runs.");
  const target = TARGET_BY_PV.get(pv)!;
  if (!target.accepts.includes(jira.kind as JiraKind)) {
    return fail("incompatible", `${label(pv)} takes ${describeAccepts(target.accepts)}, but this Jira field holds ${kindWords(jira.kind as JiraKind)}. Pick a field of a matching kind.`);
  }
  if (direction === "two_way") {
    if (!target.twoWay) return fail("two_way_not_allowed", `${label(pv)} can only be read from Jira. Product Velocity does not send it, so it cannot be two-way.`);
    if (JIRA_READ_ONLY_IDS.includes(jira.id) || (!jira.custom && !["duedate", "labels", "priority"].includes(jira.id))) return fail("jira_read_only", "Jira does not let this system field be written, so it can only be read.");
    if (!WRITABLE_KINDS.includes(jira.kind as JiraKind)) return fail("jira_read_only", `Product Velocity cannot write ${kindWords(jira.kind as JiraKind)} to Jira, so this field can only be read.`);
  }
  return { ok: true };
}

const KIND_WORDS: Record<JiraKind, string> = {
  text: "text", number: "a number", date: "a date", datetime: "a date and time", select: "one choice", "multi-select": "several choices", user: "one person", users: "several people",
  labels: "labels", sprint: "sprints", link: "a web link", team: "a team", parent: "a parent issue", other: "a value this app cannot read yet",
};
export const kindWords = (k: JiraKind) => KIND_WORDS[k] ?? "an unknown value";
const describeAccepts = (kinds: readonly JiraKind[]) => kinds.map(kindWords).join(" or ");

/** What can a given PV field take, for the picker: the PV fields a Jira field of this kind may map to, with the allowed directions. */
export function targetsForJira(jira: JiraFieldRef): { pv: string; directions: JiraDirection[] }[] {
  if (JIRA_UNMAPPABLE_IDS.includes(jira.id)) return [];
  return JIRA_TARGETS.filter((t) => t.accepts.includes(jira.kind as JiraKind)).map((t) => ({
    pv: t.pv,
    directions: (["read", "two_way"] as const).filter((d) => validateJiraMapping(jira, t.pv, d).ok),
  })).filter((t) => t.directions.length > 0);
}

/** A stored mapping row, as the sync sessions read it. */
export type JiraFieldMapping = { jiraFieldId: string; jiraFieldName: string; jiraKind: JiraKind; pvField: string; direction: JiraDirection };

/**
 * A proposal from the role hints (never applied without an admin choosing it). Story points have no matching field: the dictionary's Effort is a
 * T-shirt size and its estimates are in weeks, and points are neither, so no proposal is made for them.
 */
export type RoleHint = "story_points" | "start_date" | "due_date" | "sprint" | "team" | "labels" | "priority" | "assignee" | "parent" | "epic_link";
const SUGGESTED_BY_ROLE: Partial<Record<RoleHint, { pv: string; direction: JiraDirection }>> = {
  start_date: { pv: "planned_start", direction: "read" },
  due_date: { pv: "g2m_date_est", direction: "read" },
  team: { pv: "contributing_teams", direction: "read" },
  labels: { pv: "tags", direction: "read" },
  assignee: { pv: "assignees", direction: "read" },
};
export function suggestMapping(jira: JiraFieldRef & { role: string | null }): { pv: string; direction: JiraDirection } | null {
  const s = jira.role ? SUGGESTED_BY_ROLE[jira.role as RoleHint] : undefined;
  return s && validateJiraMapping(jira, s.pv, s.direction).ok ? s : null;
}
