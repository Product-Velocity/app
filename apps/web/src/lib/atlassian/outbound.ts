import { BASE_LABEL, OWNED_LABEL_PREFIX, changeTypeLabel, groupLabel, moscowLabel, projectLabel, rankBandLabel } from "@pv/github";
import { markdownToAdf, type AdfDoc } from "./adf";

// Everything that may leave the app for Jira (CLAUDE.md rule 2, issue #67). Jira sites can be shared widely, so this list is the ONLY place
// a field of an item is read for a Jira payload. Value, confidence, customers, decisions, rationale, key results, outcomes, markets and the
// rank number are never listed, and a test (outbound-allowlist.test.ts) fails if any of them reaches a payload. Status, sprint and
// transitions are never written (rule 6): this builder has no input for them.
export const OUTBOUND_JIRA_FIELDS = ["initiative_name", "description", "moscow", "g2m_date_est", "planned_start", "stack_rank", "change_type", "theme"] as const;
export type JiraOutboundField = (typeof OUTBOUND_JIRA_FIELDS)[number];

/** How this Jira site spells the fields PV can fill; each is optional and a missing one is skipped with a note in the preview, never guessed. */
export type JiraFieldMap = {
  /** Custom field id of "Start date" (site specific, from the field catalog). */
  startDate?: string;
  /** Jira priority id per MoSCoW value, chosen by the user; unmapped values leave the priority alone. */
  priorityByMoscow?: Partial<Record<"Must" | "Should" | "Could" | "Won't", string>>;
};
export type JiraPayloadInput = {
  /** Read through the allowlist only. */
  item: Record<string, unknown>;
  fields: JiraFieldMap;
  /** On create: project key and issue type id (the initiative type of the project link). */
  create?: { projectKey: string; issueTypeId: string };
  /** Key of the Jira parent, when the initiative has one that is itself linked. */
  parentKey?: string | null;
  /** The name of the Product Velocity project, for its `pv:project/…` label (as on GitHub). */
  projectName?: string;
  /** An opaque label (a hash of the item id, never the id) put on a CREATED issue, so a create whose answer was lost is found again instead of repeated. */
  marker?: string;
  /** Labels the issue has now: people's labels are kept, `pv:` labels that no longer apply are removed. Omit on create. */
  currentLabels?: string[];
};
export type JiraPayload = { fields: Record<string, unknown>; /** What was left out and why, for the preview. */ notes: string[]; /** The Markdown the description was made from. */ descriptionSource: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const DATE = /^\d{4}-\d{2}-\d{2}/;
/** Read an item field, only if it is on the allowlist. */
function read(item: Record<string, unknown>, key: JiraOutboundField): unknown { return (OUTBOUND_JIRA_FIELDS as readonly string[]).includes(key) ? item[key] : undefined; }

/**
 * The `pv:` labels an item should carry, the same as the GitHub sync sends: the base label, the project, MoSCoW, the rank BAND (top 10, top 25,
 * top 50, later; never the number), Change Type and Initiative Group. Nothing commercial is ever a label.
 */
export function desiredLabels(item: Record<string, unknown>, projectName?: string): string[] {
  return [BASE_LABEL, projectName ? projectLabel(projectName) : null, moscowLabel(read(item, "moscow")), rankBandLabel(read(item, "stack_rank")), changeTypeLabel(read(item, "change_type")), groupLabel(read(item, "theme"))].filter((l): l is string => !!l);
}
/** Labels after a write: the person's own labels stay, `pv:` labels are replaced by the desired ones. */
export function mergeLabels(current: string[], desired: string[]): string[] {
  return [...new Set([...current.filter((l) => l !== BASE_LABEL && !l.startsWith(OWNED_LABEL_PREFIX)), ...desired])];
}

export function buildJiraPayload(input: JiraPayloadInput): JiraPayload {
  const { item, fields: map } = input;
  const notes: string[] = [];
  const name = str(read(item, "initiative_name"), 240) || "(untitled initiative)";
  const description = typeof read(item, "description") === "string" ? (read(item, "description") as string).slice(0, 30000) : "";
  const f: Record<string, unknown> = {
    summary: name, // the issue key already identifies it; no code prefix, so an adopted issue keeps its own title
    description: markdownToAdf(description) satisfies AdfDoc,
    labels: mergeLabels(input.currentLabels ?? [], [...desiredLabels(item, input.projectName), ...(input.marker && /^pv:item\/[0-9a-f]{16}$/.test(input.marker) ? [input.marker] : [])]),
  };
  if (input.create) { f.project = { key: input.create.projectKey }; f.issuetype = { id: input.create.issueTypeId }; }
  if (input.parentKey) f.parent = { key: input.parentKey };

  const due = read(item, "g2m_date_est");
  if (typeof due === "string" && DATE.test(due)) f.duedate = due.slice(0, 10);
  const start = read(item, "planned_start");
  if (typeof start === "string" && DATE.test(start)) {
    if (map.startDate && /^customfield_\d{1,9}$/.test(map.startDate)) f[map.startDate] = start.slice(0, 10);
    else notes.push("Start date not sent: this Jira site's Start date field is not mapped.");
  }
  const moscow = read(item, "moscow");
  if (typeof moscow === "string" && moscow) {
    const id = map.priorityByMoscow?.[moscow as keyof NonNullable<JiraFieldMap["priorityByMoscow"]>];
    if (id && /^[0-9]{1,9}$/.test(id)) f.priority = { id };
    else notes.push("Priority not sent: no Jira priority is chosen for this MoSCoW value (the pv:moscow label is sent).");
  }
  return { fields: f, notes, descriptionSource: description };
}
