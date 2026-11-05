import { BASE_LABEL, OWNED_LABEL_PREFIX, changeTypeLabel, focusAreaLabel, groupLabel, moscowLabel, projectLabel, plannedQuarterLabel, rankBandLabel, tagLabels, valueTypeLabel, reviewLabel } from "@pv/github";
import { composeDescription, type Link } from "./jira-sections";

// Everything that may leave the app for Jira (CLAUDE.md rule 2, issue #67). Jira sites can be shared widely, so this list is the ONLY place
// a field of an item is read for a Jira payload. Value, confidence, customers, decisions, rationale, key results, outcomes, markets and the
// rank number are never listed, and a test (outbound-allowlist.test.ts) fails if any of them reaches a payload. Status, sprint and
// transitions are never written (rule 6): this builder has no input for them.
export const OUTBOUND_JIRA_FIELDS = ["initiative_name", "summary", "description", "hypothesis", "moscow", "g2m_date_est", "planned_start", "stack_rank", "change_type", "theme", "focus_area", "value_type", "g2m_quarter", "tags", "initiative_phase"] as const;
export type JiraOutboundField = (typeof OUTBOUND_JIRA_FIELDS)[number];

/** How this Jira site spells the fields PV can fill; each is optional and a missing one is skipped with a note in the preview, never guessed. */
export type JiraFieldMap = {
  /** Custom field id of "Start date" (site specific, from the field catalog). */
  startDate?: string;
  /** Custom field id of a single-line TEXT field that receives the Focus Area (site specific; "Theme" on many sites). The Initiative Group goes only into a label. */
  theme?: string;
  /** Jira priority id per MoSCoW value, chosen by the user; unmapped values leave the priority alone. */
  priorityByMoscow?: Partial<Record<"Must" | "Should" | "Could" | "Won't", string>>;
  /** Field that receives G2M Date (est): the system `duedate` unless the admin chose another date field (field configuration). */
  dueDate?: string;
  /** Slots switched off in the field configuration (`jira.dueDate`, `jira.label.*`): nothing is sent for them. */
  off?: readonly string[];
  /** Slots switched ON that are off by default (`jira.label.tags`, `jira.label.focus`). */
  on?: readonly string[];
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
  /** Links of the initiative (Artifacts section) and the share links of its files (Files section). Both are sent only; a slot switched off leaves its section out. */
  artifacts?: Link[];
  files?: Link[];
  /** Labels the issue has now: people's labels are kept, `pv:` labels that no longer apply are removed. Omit on create. */
  currentLabels?: string[];
};
export type JiraPayload = { fields: Record<string, unknown>; /** What was left out and why, for the preview. */ notes: string[]; /** The Markdown the description was made from. */ descriptionSource: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
/** The Focus Area as one line of plain text for a Jira text field: control characters and line breaks removed, at most 255 characters (the limit of a single-line field). */
const themeText = (v: unknown) => str(v, 4000).replace(/\s+/g, " ").trim().slice(0, 255);
const DATE = /^\d{4}-\d{2}-\d{2}/;
/** Read an item field, only if it is on the allowlist. */
function read(item: Record<string, unknown>, key: JiraOutboundField): unknown { return (OUTBOUND_JIRA_FIELDS as readonly string[]).includes(key) ? item[key] : undefined; }

/**
 * The `pv:` labels an item should carry, the same as the GitHub sync sends: the base label, the project, MoSCoW, the rank BAND (top 10, top 25,
 * top 50, later; never the number), Change Type and Initiative Group. Nothing commercial is ever a label.
 */
export function desiredLabels(item: Record<string, unknown>, projectName?: string, off: readonly string[] = [], optIn: readonly string[] = []): string[] {
  const on = (slot: string) => !off.includes(slot);
  const opt = (slot: string) => optIn.includes(slot);
  return [BASE_LABEL, projectName && on("jira.label.project") ? projectLabel(projectName) : null, on("jira.label.moscow") ? moscowLabel(read(item, "moscow")) : null, on("jira.label.rank") ? rankBandLabel(read(item, "stack_rank")) : null, on("jira.label.type") ? changeTypeLabel(read(item, "change_type")) : null, on("jira.label.group") ? groupLabel(read(item, "theme")) : null, opt("jira.label.focus") ? focusAreaLabel(read(item, "focus_area")) : null, on("jira.label.value") ? valueTypeLabel(read(item, "value_type")) : null, on("jira.label.quarter") ? plannedQuarterLabel(read(item, "g2m_quarter")) : null, ...(opt("jira.label.tags") ? tagLabels(read(item, "tags")) : []), reviewLabel(read(item, "initiative_phase"))].filter((l): l is string => !!l);
}
/** Put on a Jira issue when its initiative was removed in Product Velocity and the person confirmed (jira-close.ts). Not an "owned" label: a later send must not strip it. */
export const REMOVED_LABEL = "pv:removed";
/** Labels after a write: the person's own labels stay, `pv:` labels are replaced by the desired ones (`pv:removed` stays: it records a close). */
export function mergeLabels(current: string[], desired: string[]): string[] {
  return [...new Set([...current.filter((l) => l === REMOVED_LABEL || (l !== BASE_LABEL && !l.startsWith(OWNED_LABEL_PREFIX))), ...desired])];
}

export function buildJiraPayload(input: JiraPayloadInput): JiraPayload {
  const { item, fields: map } = input;
  const notes: string[] = [];
  const name = str(read(item, "initiative_name"), 240) || "(untitled initiative)";
  const description = typeof read(item, "description") === "string" ? (read(item, "description") as string).slice(0, 30000) : "";
  const f: Record<string, unknown> = {
    summary: name, // the issue key already identifies it; no code prefix, so an adopted issue keeps its own title
    // headed sections like the managed block of a GitHub issue (issue #319): Summary, Description, Hypothesis, then the links
    description: composeDescription({
      pv: { summary: typeof read(item, "summary") === "string" ? (read(item, "summary") as string).slice(0, 4000) : "", description, hypothesis: typeof read(item, "hypothesis") === "string" ? (read(item, "hypothesis") as string).slice(0, 4000) : "" },
      ...(map.off?.includes("jira.body.artifacts") ? {} : { artifacts: input.artifacts ?? [] }), ...(map.off?.includes("jira.body.files") ? {} : { files: input.files ?? [] }),
    }),
    labels: mergeLabels(input.currentLabels ?? [], [...desiredLabels(item, input.projectName, map.off, map.on), ...(input.marker && /^pv:item\/[0-9a-f]{16}$/.test(input.marker) ? [input.marker] : [])]),
  };
  if (input.create) { f.project = { key: input.create.projectKey }; f.issuetype = { id: input.create.issueTypeId }; }
  if (input.parentKey) f.parent = { key: input.parentKey };

  const off = (slot: string) => map.off?.includes(slot) ?? false;
  const due = read(item, "g2m_date_est");
  if (typeof due === "string" && DATE.test(due)) {
    if (off("jira.dueDate")) notes.push("Due date not sent: switched off in the field configuration.");
    else f[map.dueDate && /^(duedate|customfield_\d{1,9})$/.test(map.dueDate) ? map.dueDate : "duedate"] = due.slice(0, 10);
  }
  const start = read(item, "planned_start");
  if (typeof start === "string" && DATE.test(start)) {
    if (map.startDate && /^customfield_\d{1,9}$/.test(map.startDate)) f[map.startDate] = start.slice(0, 10);
    else notes.push("Start date not sent: this Jira site's Start date field is not mapped.");
  }
  const focus = themeText(read(item, "focus_area"));
  if (focus) {
    if (map.theme && /^customfield_\d{1,9}$/.test(map.theme)) f[map.theme] = focus;
    else notes.push("Theme not sent: this Jira site's Theme field is not mapped (Focus Area is also sent as a label when that switch is on).");
  }
  const switchedOff: [string, string, unknown][] = [["jira.label.moscow", "MoSCoW label", read(item, "moscow")], ["jira.label.rank", "Rank label", read(item, "stack_rank")], ["jira.label.type", "Change Type label", read(item, "change_type")], ["jira.label.group", "Initiative Group label", read(item, "theme")], ["jira.label.quarter", "Planned Quarter label", read(item, "g2m_quarter")]];
  for (const [slot, what, v] of switchedOff) if (off(slot) && v !== undefined && v !== null && v !== "") notes.push(`${what} not sent: switched off in the field configuration.`);
  if (off("jira.body.artifacts") && (input.artifacts?.length ?? 0) > 0) notes.push("Artifact links not sent: switched off in the field configuration.");
  if (off("jira.body.files") && (input.files?.length ?? 0) > 0) notes.push("File links not sent: switched off in the field configuration.");
  const moscow = read(item, "moscow");
  if (typeof moscow === "string" && moscow) {
    const id = map.priorityByMoscow?.[moscow as keyof NonNullable<JiraFieldMap["priorityByMoscow"]>];
    if (id && /^[0-9]{1,9}$/.test(id)) f.priority = { id };
    else notes.push("Priority not sent: no Jira priority is chosen for this MoSCoW value (the pv:moscow label is sent).");
  }
  return { fields: f, notes, descriptionSource: description };
}
