import { buildFieldCatalog, fieldKind, type FieldKind, type JiraField, type JiraIssueSample } from "@/lib/atlassian/field-catalog";
import type { BoardField, IssueFieldInfo, LabelInfo, MilestoneInfo } from "@pv/github";

// The read-only field catalog of a delivery tracker (decision 2026-11-03-tracker-field-config, slice 2): everything the connection can see, in one
// shape for GitHub and Jira, so the configuration can offer it. Pure functions, no network. A tracker field that is not mapped stays visible here and
// is ignored by the sync; the 169-field dictionary does not grow.

/** What a tracker field holds, reduced to what the mapping needs to decide whether a Product Velocity field can use it. */
export type CatalogKind = "text" | "long_text" | "number" | "date" | "select" | "multi_select" | "user" | "labels" | "milestone" | "issue_type" | "iteration" | "other";

export type CatalogEntry = {
  id: string;
  name: string;
  /** A field somebody added (Jira custom field, GitHub organisation or board field) rather than one the tracker always has. */
  custom: boolean;
  kind: CatalogKind;
  /** The tracker's own name for the type, for people ("Single select", "Date picker"). */
  typeLabel: string;
  /** Option names, at most 20. */
  options: string[];
  /** Issues in the sample that have a value, and the sample size; null when the fill rate was not sampled. */
  filled: number | null;
  sampled: number | null;
  /** Where it comes from, when a group mixes sources (a board's title, a repository). */
  source?: string;
};
export type CatalogGroup = {
  id: string;
  title: string;
  entries: CatalogEntry[];
  /** Set when this part could not be read just now (the other groups still show). */
  error: string | null;
  /** A note under the title (what is read, what is sampled). */
  note?: string;
};
export type TrackerCatalog = { tracker: "github" | "jira"; scope: string; groups: CatalogGroup[]; readAt: string };

const MAX_OPTIONS = 20;
const cut = (s: string, n = 100) => s.slice(0, n);

const JIRA_KIND: Record<FieldKind, CatalogKind> = { text: "text", number: "number", date: "date", datetime: "date", select: "select", "multi-select": "multi_select", user: "user", users: "user", labels: "labels", sprint: "iteration", link: "text", other: "other" };
const JIRA_TYPE_LABEL: Record<FieldKind, string> = { text: "Text", number: "Number", date: "Date", datetime: "Date and time", select: "Select", "multi-select": "Multi select", user: "User", users: "Users", labels: "Labels", sprint: "Sprint", link: "URL", other: "Other" };

/** The options Jira shows on issues in the sample for a select field ("seen in the sample": a site's full option list needs a call per field context). */
export function sampledOptions(fieldId: string, issues: JiraIssueSample[]): string[] {
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") seen.add(cut(v));
    else if (typeof v === "object" && v !== null) {
      const o = v as Record<string, unknown>;
      const n = typeof o.value === "string" ? o.value : typeof o.name === "string" ? o.name : null;
      if (n) seen.add(cut(n));
    }
  };
  for (const issue of issues) {
    const v = issue.fields?.[fieldId];
    if (Array.isArray(v)) v.forEach(add); else add(v);
    if (seen.size >= MAX_OPTIONS) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).slice(0, MAX_OPTIONS);
}

/** Jira: every field of the site (system and custom, by id: names are not unique), with a sampled fill rate, the priorities and the issue types. */
export function jiraCatalogGroups(input: { fields: JiraField[] | null; issues: JiraIssueSample[]; priorities: { id: string; name: string }[] | null; issueTypes: { id: string; name: string; hierarchyLevel: number }[] | null; fieldsError?: string | null; sampleError?: string | null }): CatalogGroup[] {
  const groups: CatalogGroup[] = [];
  const fields: CatalogGroup = { id: "fields", title: "Issue fields", entries: [], error: input.fieldsError ?? (input.fields === null ? "The fields of this Jira site could not be read just now." : null), note: input.sampleError ? "The fill rate could not be sampled just now." : `Fill rate: issues with a value among the ${input.issues.length} most recently updated issues of the project.` };
  if (input.fields) {
    const byId = new Map(input.fields.map((f) => [f.id, f]));
    fields.entries = buildFieldCatalog(input.fields, input.issues).map((r) => ({
      id: r.id, name: cut(r.name), custom: r.custom, kind: JIRA_KIND[r.kind], typeLabel: JIRA_TYPE_LABEL[fieldKind(byId.get(r.id)?.schema)],
      options: r.kind === "select" || r.kind === "multi-select" ? sampledOptions(r.id, input.issues) : [],
      filled: input.sampleError ? null : r.filled, sampled: input.sampleError ? null : r.sampled,
    }));
  }
  groups.push(fields);
  groups.push({ id: "priorities", title: "Priorities", error: input.priorities === null ? "The priorities could not be read just now." : null, entries: (input.priorities ?? []).map((p) => ({ id: p.id, name: cut(p.name), custom: false, kind: "select" as const, typeLabel: "Priority", options: [], filled: null, sampled: null })) });
  groups.push({ id: "issuetypes", title: "Issue types", error: input.issueTypes === null ? "The issue types could not be read just now." : null, entries: (input.issueTypes ?? []).map((t) => ({ id: t.id, name: cut(t.name), custom: false, kind: "issue_type" as const, typeLabel: `Level ${t.hierarchyLevel}`, options: [], filled: null, sampled: null })) });
  return groups;
}

const BOARD_KIND: Record<BoardField["dataType"], CatalogKind> = { TEXT: "text", NUMBER: "number", DATE: "date", SINGLE_SELECT: "select", ITERATION: "iteration", OTHER: "other" };
const BOARD_LABEL: Record<BoardField["dataType"], string> = { TEXT: "Text", NUMBER: "Number", DATE: "Date", SINGLE_SELECT: "Single select", ITERATION: "Iteration", OTHER: "Other" };
const ISSUE_FIELD_KIND: Record<IssueFieldInfo["dataType"], CatalogKind> = { text: "text", number: "number", date: "date", single_select: "select", other: "other" };
const ISSUE_FIELD_LABEL: Record<IssueFieldInfo["dataType"], string> = { text: "Text", number: "Number", date: "Date", single_select: "Single select", other: "Other" };

/** The built-in fields of a GitHub issue that Product Velocity uses today, so the catalog also shows where the labels and milestone go. */
const SYSTEM_ISSUE_FIELDS: CatalogEntry[] = [
  { id: "title", name: "Title", custom: false, kind: "text", typeLabel: "Text", options: [], filled: null, sampled: null },
  { id: "body", name: "Body", custom: false, kind: "long_text", typeLabel: "Markdown", options: [], filled: null, sampled: null },
  { id: "labels", name: "Labels", custom: false, kind: "labels", typeLabel: "Labels", options: [], filled: null, sampled: null },
  { id: "milestone", name: "Milestone", custom: false, kind: "milestone", typeLabel: "Milestone", options: [], filled: null, sampled: null },
  { id: "assignees", name: "Assignees", custom: false, kind: "user", typeLabel: "Users", options: [], filled: null, sampled: null },
  { id: "type", name: "Issue type", custom: false, kind: "issue_type", typeLabel: "Organisation issue type", options: [], filled: null, sampled: null },
];

export type GithubCatalogInput = {
  /** null = the App may not read issue fields (needs the organisation permission "Issue fields", read). */
  issueFields: IssueFieldInfo[] | null;
  issueFieldsError?: string | null;
  boards: { title: string; fields: BoardField[] | null; error?: string | null }[];
  labels: { repo: string; labels: LabelInfo[]; error?: string | null }[];
  issueTypes: string[] | null;
  milestones: { repo: string; milestones: MilestoneInfo[]; error?: string | null }[];
};

/** GitHub: issue fields of the organisation, the built-in issue fields, the fields of each linked Projects v2 board, labels, issue types and milestones. */
export function githubCatalogGroups(i: GithubCatalogInput): CatalogGroup[] {
  const groups: CatalogGroup[] = [];
  groups.push({
    id: "issue-fields", title: "Organisation issue fields", error: i.issueFieldsError ?? null,
    note: i.issueFields === null && !i.issueFieldsError ? "The GitHub App cannot read the organisation's issue fields yet. Add the organisation permission “Issue fields” (read) to the App and accept it on the installation (docs/08 S3b). They are not written by Product Velocity yet." : "Read only: Product Velocity does not write issue fields yet (GitHub refuses them through the board).",
    entries: (i.issueFields ?? []).map((f) => ({ id: f.id, name: cut(f.name), custom: true, kind: ISSUE_FIELD_KIND[f.dataType], typeLabel: ISSUE_FIELD_LABEL[f.dataType], options: f.options.slice(0, MAX_OPTIONS), filled: null, sampled: null })),
  });
  groups.push({ id: "issue", title: "Issue (built in)", error: null, entries: SYSTEM_ISSUE_FIELDS });
  for (const b of i.boards) {
    groups.push({
      id: `board-${b.title}`, title: `Project board: ${b.title}`, error: b.error ?? (b.fields === null ? "This board could not be read just now." : null),
      entries: (b.fields ?? []).map((f) => ({ id: f.id, name: cut(f.name), custom: !["Title", "Assignees", "Labels", "Repository", "Milestone", "Reviewers", "Linked pull requests", "Parent issue", "Sub-issues progress", "Tracks", "Tracked by"].includes(f.name), kind: BOARD_KIND[f.dataType], typeLabel: BOARD_LABEL[f.dataType], options: (f.options ?? []).map((o) => cut(o.name)).slice(0, MAX_OPTIONS), filled: null, sampled: null, source: b.title })),
    });
  }
  groups.push({ id: "issue-types", title: "Organisation issue types", error: null, note: i.issueTypes === null ? "The App cannot read the organisation's issue types yet." : undefined, entries: (i.issueTypes ?? []).map((t) => ({ id: `type:${t}`, name: cut(t), custom: false, kind: "issue_type" as const, typeLabel: "Issue type", options: [], filled: null, sampled: null })) });
  for (const l of i.labels) groups.push({ id: `labels-${l.repo}`, title: `Labels: ${l.repo}`, error: l.error ?? null, note: "Labels beginning with pv: belong to Product Velocity.", entries: l.labels.map((x) => ({ id: `label:${x.name}`, name: cut(x.name), custom: !x.name.startsWith("pv:") && x.name !== "product-velocity", kind: "labels" as const, typeLabel: x.name.startsWith("pv:") || x.name === "product-velocity" ? "Label (Product Velocity)" : "Label", options: [], filled: null, sampled: null, source: l.repo })) });
  for (const m of i.milestones) groups.push({ id: `milestones-${m.repo}`, title: `Milestones: ${m.repo}`, error: m.error ?? null, entries: m.milestones.map((x) => ({ id: `milestone:${x.title}`, name: cut(x.title), custom: false, kind: "milestone" as const, typeLabel: x.state === "closed" ? "Milestone (closed)" : "Milestone", options: [], filled: null, sampled: null, source: m.repo })) });
  return groups;
}
