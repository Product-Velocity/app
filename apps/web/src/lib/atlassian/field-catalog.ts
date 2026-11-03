// Field catalog (docs/16, decision 3; spike J2, #257/#69): turns what a Jira site reports about its fields, issue
// types and a sample of issues into one list the user can map from. Pure functions, no network. Nothing here
// invents a Product Velocity field: the `role` is only a hint about what a Jira field usually means.

import type { JiraKind } from "@pv/domain";

export type JiraSchema = { type: string; items?: string; system?: string; custom?: string; customId?: number };
export type JiraField = { id: string; name: string; custom: boolean; clauseNames?: string[]; schema?: JiraSchema };
export type JiraIssueType = { id: string; name: string; hierarchyLevel: number; subtask?: boolean };
export type JiraIssueSample = { fields?: Record<string, unknown> };

/** The kinds are those of the mapping rules in @pv/domain (`JiraKind`); `other` is a value this app has no rule for yet. */
export type FieldKind = JiraKind;
export type FieldRole = "story_points" | "start_date" | "due_date" | "sprint" | "team" | "labels" | "priority" | "assignee" | "parent" | "epic_link";

export type CatalogRow = {
  id: string;
  name: string;
  custom: boolean;
  kind: FieldKind;
  role: FieldRole | null;
  /** Issues in the sample that have a value, and the sample size. */
  filled: number;
  sampled: number;
};

export function fieldKind(schema: JiraSchema | undefined): FieldKind {
  if (!schema) return "other";
  const custom = schema.custom ?? "";
  if (custom.endsWith("gh-sprint") || schema.items === "json" && custom.includes("sprint")) return "sprint";
  if (custom.endsWith(":multiselect") || custom.endsWith(":multicheckboxes")) return "multi-select";
  if (custom.endsWith(":select") || custom.endsWith(":radiobuttons") || custom.endsWith(":cascadingselect")) return "select";
  if (custom.endsWith(":labels") || schema.type === "array" && schema.items === "string" && schema.system === "labels") return "labels";
  if (custom.endsWith(":userpicker")) return "user";
  if (custom.endsWith(":multiuserpicker")) return "users";
  if (custom.endsWith(":url")) return "link";
  // objects that used to come back as "other" (spike J2): the Team field and the parent link
  if (schema.type === "team" || custom.endsWith(":atlassian-team")) return "team";
  if (schema.system === "parent" || schema.type === "issuelink" && schema.system === "parent") return "parent";
  switch (schema.type) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "user":
      return "user";
    case "priority":
    case "option":
      return "select";
    case "array":
      return schema.items === "user" ? "users" : schema.items === "option" ? "multi-select" : "other";
    default:
      return "other";
  }
}

const ROLE_BY_NAME: [RegExp, FieldRole][] = [
  [/^story point(s| estimate)?$/i, "story_points"],
  [/^start date$/i, "start_date"],
  [/^(due date|target end|target date)$/i, "due_date"],
  [/^sprint$/i, "sprint"],
  [/^team$/i, "team"],
  [/^epic link$/i, "epic_link"],
];

/** What a field usually means. Names are site specific (decision 3), so this is a hint the user confirms. */
export function fieldRole(f: JiraField): FieldRole | null {
  if (f.id === "labels") return "labels";
  if (f.id === "priority") return "priority";
  if (f.id === "assignee") return "assignee";
  if (f.id === "parent") return "parent";
  if (f.id === "duedate") return "due_date";
  for (const [re, role] of ROLE_BY_NAME) if (re.test(f.name.trim())) return role;
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Jira always returns some fields as containers even when nobody used them (comments with total 0, votes 0,
 * workratio -1), so "is there an object" says nothing. Seen on a real site in spike J2.
 */
const EMPTY_CONTAINER: Record<string, (v: Obj) => boolean> = {
  comment: (v) => !(Number(v.total) > 0),
  worklog: (v) => !(Number(v.total) > 0),
  progress: (v) => !(Number(v.total) > 0),
  aggregateprogress: (v) => !(Number(v.total) > 0),
  votes: (v) => !(Number(v.votes) > 0),
  watches: (v) => !(Number(v.watchCount) > 0),
  issuerestriction: (v) => !isObj(v.issuerestrictions) || Object.keys(v.issuerestrictions).length === 0,
};

export function fieldHasValue(id: string, v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (id === "workratio") return v !== -1;
  if (isObj(v)) return !(EMPTY_CONTAINER[id]?.(v) ?? false) && Object.keys(v).length > 0;
  return true;
}

/** How many sampled issues carry a value for each field id. */
export function tallyFill(issues: JiraIssueSample[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    for (const [id, v] of Object.entries(issue.fields ?? {})) if (fieldHasValue(id, v)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function buildFieldCatalog(fields: JiraField[], issues: JiraIssueSample[]): CatalogRow[] {
  const fill = tallyFill(issues);
  return fields
    .map((f) => ({
      id: f.id,
      name: f.name,
      custom: f.custom,
      kind: fieldKind(f.schema),
      role: fieldRole(f),
      filled: fill.get(f.id) ?? 0,
      sampled: issues.length,
    }))
    .sort((a, b) => Number(b.role !== null) - Number(a.role !== null) || Number(a.custom) - Number(b.custom) || a.name.localeCompare(b.name));
}

export type HierarchyLevel = { level: number; types: string[] };

/** Issue types grouped by hierarchy level: 1 is Epic, 0 the base level (Story, Task, Bug), -1 Sub-task, 2 and up sit above Epic. */
export function hierarchyLevels(types: JiraIssueType[]): HierarchyLevel[] {
  const byLevel = new Map<number, string[]>();
  for (const t of types) byLevel.set(t.hierarchyLevel, [...(byLevel.get(t.hierarchyLevel) ?? []), t.name]);
  // Team-managed projects each have their own "Epic" type, so one name can appear several times on a site.
  return [...byLevel.entries()].sort((a, b) => b[0] - a[0]).map(([level, names]) => ({ level, types: [...new Set(names)].sort() }));
}

/** The proposal for "what is an initiative here" (docs/16 mapping table). The user confirms it per connection. */
export function proposeInitiativeLevel(levels: HierarchyLevel[]): { source: "standard" | "above-epic"; types: string[] } {
  const above = levels.filter((l) => l.level >= 2).sort((a, b) => a.level - b.level)[0];
  if (above) return { source: "above-epic", types: above.types };
  return { source: "standard", types: levels.find((l) => l.level === 1)?.types ?? ["Epic"] };
}
