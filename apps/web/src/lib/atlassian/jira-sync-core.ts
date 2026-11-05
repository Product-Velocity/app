import { createHash } from "node:crypto";
import { compareTexts, hashText, type TextVerdict } from "@pv/github";
import { adfToText, markdownToAdf, type AdfNode } from "./adf";
import { TEXT_SECTIONS, attachmentsHash, attachmentsText, composeDescription, isSimpleNodes, nodesText, splitDescription, type Link, type Split, type TextSection } from "./jira-sections";
import { buildJiraPayload, type JiraFieldMap } from "./outbound";
import { cleanTitle } from "./read-issues";

// The decisions of "Sync with Jira" without any network or database (issue #67, #71): compare Product Velocity with the Jira issue three ways
// (the base is what both sides agreed at the last sync, hashes only), decide what goes out, what is taken over, and what is still a conflict.
// Pure, so the whole table is tested. Status is not an input anywhere (rule 6); nothing here can transition an issue.

export type PvItem = { focus_area?: string | null; roadmap_category?: string | null; tags?: string[]; id: string; name: string; summary?: string | null; description: string | null; hypothesis?: string | null; moscow?: string | null; g2m_date_est?: string | null; planned_start?: string | null; stack_rank?: number | null; change_type?: string | null; theme?: string | null };
export type JiraNow = { summary: string; description: unknown; labels: string[] };
/** Hashes both sides agreed on at the last sync. `attachments` is the hash of the Artifacts and Files sections as last written. */
export type JiraBase = { title?: string; summary?: string; description?: string; hypothesis?: string; attachments?: string };
export type Side = "pv" | "jira";
/** The compared texts: the name (the Jira summary) and the three sections of the description. */
export type TextField = "title" | TextSection;
export const TEXT_FIELDS: readonly TextField[] = ["title", ...TEXT_SECTIONS];
export const COLUMN: Record<TextField, "initiative_name" | "summary" | "description" | "hypothesis"> = { title: "initiative_name", summary: "summary", description: "description", hypothesis: "hypothesis" };
export const LABEL: Record<TextField, string> = { title: "Name", summary: "Summary", description: "Description", hypothesis: "Hypothesis" };

export type FieldCompare = { field: TextField; verdict: TextVerdict; pvText: string; jiraText: string; pvHash: string; jiraHash: string };

/** Opaque label for a created issue so a lost answer is found again (a hash, never the item id). */
export const markerFor = (itemId: string) => `pv:item/${createHash("sha256").update(`pv-jira-marker:${itemId}`).digest("hex").slice(0, 16)}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export type Compared = { fields: FieldCompare[]; /** The sections of the Jira description that have content this converter cannot write back. */ richIn: TextSection[]; rich: boolean; split: Split };

export function compareJira(pv: PvItem, jira: JiraNow, base: JiraBase | null | undefined): Compared {
  const split = splitDescription(jira.description);
  const pvTexts: Record<TextField, string> = { title: cleanTitle(pv.name), summary: adfToText(markdownToAdf(pv.summary ?? "")), description: adfToText(markdownToAdf(pv.description ?? "")), hypothesis: adfToText(markdownToAdf(pv.hypothesis ?? "")) };
  const jiraTexts: Record<TextField, string> = { title: cleanTitle(jira.summary), summary: nodesText(split.nodes.summary), description: nodesText(split.nodes.description), hypothesis: nodesText(split.nodes.hypothesis) };
  const fields = TEXT_FIELDS.map((field): FieldCompare => {
    const pvHash = hashText(pvTexts[field]);
    const jiraHash = hashText(jiraTexts[field]);
    let verdict = compareTexts(base?.[field], pvHash, jiraHash);
    // a section Product Velocity has text for and Jira has none, never recorded before (the first sync after sections were introduced): nothing to lose, it is sent
    if (verdict === "both" && field !== "title" && base?.[field] === undefined && jiraTexts[field] === "") verdict = "send";
    return { field, verdict, pvText: pvTexts[field], jiraText: jiraTexts[field], pvHash, jiraHash };
  });
  const richIn = TEXT_SECTIONS.filter((k) => !isSimpleNodes(split.nodes[k]));
  return { fields, richIn, rich: richIn.length > 0, split };
}

export type Picks = Partial<Record<TextField, Side>>;
export type SendPlan = {
  action: "create" | "update" | "unchanged";
  /** The fields object for Jira (create or update); empty for "unchanged". */
  fields: Record<string, unknown>;
  /** Texts to take over from Jira into Product Velocity, by column. */
  takeOver: Partial<Record<"initiative_name" | "summary" | "description" | "hypothesis", string>>;
  /** Fields of the texts that are still conflicts for lack of a choice. */
  unresolved: TextField[];
  /** The agreed hashes after this sync (stored only after the write succeeded). */
  newBase: JiraBase;
  sentHash: string;
  notes: string[];
  /** The texts that this plan writes (the three sections are written together, as one description). */
  writes: TextField[];
};

type PlanInput = {
  pv: PvItem;
  /** null = the initiative has no Jira issue yet (create). */
  jira: JiraNow | null;
  base?: JiraBase | null;
  sentHash?: string | null;
  picks?: Picks;
  map: JiraFieldMap;
  /** The name of the project (for its label). */
  projectName?: string;
  create?: { projectKey: string; issueTypeId: string };
  /** Links of the initiative and share links of its files, for the Artifacts and Files sections. */
  artifacts?: Link[];
  files?: Link[];
};

export function planJiraSend(i: PlanInput): SendPlan {
  const item = { initiative_name: i.pv.name, summary: i.pv.summary ?? "", description: i.pv.description ?? "", hypothesis: i.pv.hypothesis ?? "", moscow: i.pv.moscow ?? undefined, g2m_date_est: i.pv.g2m_date_est ?? undefined, planned_start: i.pv.planned_start ?? undefined, stack_rank: i.pv.stack_rank ?? undefined, change_type: i.pv.change_type ?? undefined, theme: i.pv.theme ?? undefined, focus_area: i.pv.focus_area ?? undefined, roadmap_category: i.pv.roadmap_category ?? undefined, tags: i.pv.tags ?? [] };
  const marker = i.jira ? undefined : markerFor(i.pv.id);
  const shown = { ...(i.map.off?.includes("jira.body.artifacts") ? {} : { artifacts: i.artifacts }), ...(i.map.off?.includes("jira.body.files") ? {} : { files: i.files }) };
  const attHash = attachmentsHash(shown.artifacts, shown.files);
  const payloadInput = { item, fields: i.map, ...(i.projectName ? { projectName: i.projectName } : {}), ...(i.artifacts ? { artifacts: i.artifacts } : {}), ...(i.files ? { files: i.files } : {}) };
  if (!i.jira) {
    const p = buildJiraPayload({ ...payloadInput, ...(i.create ? { create: i.create } : {}), ...(marker ? { marker } : {}) });
    const c = compareJira(i.pv, { summary: i.pv.name, description: null, labels: [] }, null);
    const newBase: JiraBase = { attachments: attHash };
    for (const f of c.fields) newBase[f.field] = f.pvHash;
    return { action: "create", fields: p.fields, takeOver: {}, unresolved: [], newBase, sentHash: extrasHash(p.fields), notes: p.notes, writes: [...TEXT_FIELDS] };
  }
  const cmp = compareJira(i.pv, i.jira, i.base);
  const writes: TextField[] = [];
  const takeOver: SendPlan["takeOver"] = {};
  const unresolved: TextField[] = [];
  const newBase: JiraBase = { attachments: attHash };
  const notes: string[] = [];
  for (const f of cmp.fields) {
    const choice = i.picks?.[f.field];
    if (f.verdict === "none") { newBase[f.field] = f.pvHash; continue; }
    // verdict "github" = changed only in the tracker (here Jira), "both" = changed on both sides
    if (f.verdict === "send" || ((f.verdict === "github" || f.verdict === "both") && choice === "pv")) { writes.push(f.field); newBase[f.field] = f.pvHash; continue; }
    if (choice === "jira") { takeOver[COLUMN[f.field]] = f.jiraText; newBase[f.field] = f.jiraHash; continue; }
    unresolved.push(f.field);
  }
  const p = buildJiraPayload({ ...payloadInput, currentLabels: i.jira.labels });
  const fields: Record<string, unknown> = { ...p.fields };
  if (!writes.includes("title")) delete fields.summary;

  // The description is one Jira field holding three compared sections and two sent-only ones. It is rewritten when a section is written, or when the
  // links changed since the last sync, and never while a section is still a conflict. Sections that are not written keep Jira's own content.
  const sectionWrites = TEXT_SECTIONS.filter((k) => writes.includes(k));
  const attachmentsDirty = i.base?.attachments === undefined ? attachmentsText(shown.artifacts, shown.files) !== "" : i.base.attachments !== attHash;
  const unresolvedSection = unresolved.some((f) => f !== "title");
  if ((sectionWrites.length > 0 || attachmentsDirty) && !unresolvedSection) {
    const keep: Partial<Record<TextSection, AdfNode[]>> = {};
    for (const k of TEXT_SECTIONS) if (!sectionWrites.includes(k)) keep[k] = cmp.split.nodes[k] ?? [];
    fields.description = composeDescription({ pv: { summary: i.pv.summary ?? "", description: i.pv.description ?? "", hypothesis: i.pv.hypothesis ?? "" }, keep, head: cmp.split.head, ...shown });
    const lost = sectionWrites.filter((k) => cmp.richIn.includes(k));
    if (lost.length > 0) notes.push(`The ${lost.map((k) => LABEL[k]).join(" and ")} in Jira has content Product Velocity cannot write back (a table, macro or mention). Sending replaces ${lost.length > 1 ? "those sections" : "that section"} with Product Velocity's text.`);
    if (cmp.split.legacy && sectionWrites.length > 0 && cmp.split.nodes.description) notes.push("The Jira description gets headed sections (Summary, Description, Hypothesis, Artifacts, Files), like the GitHub issue.");
  } else delete fields.description;
  // the parts that are written but not compared go out only when they changed since the last send, or when the labels in Jira are not as they should be
  const extras = { ...fields };
  delete extras.summary; delete extras.description;
  const sentHash = extrasHash(extras);
  const labelsOk = sameSet(i.jira.labels, (p.fields.labels as string[] | undefined) ?? []);
  if (sentHash === (i.sentHash ?? null) && labelsOk) for (const k of Object.keys(extras)) delete fields[k];
  notes.push(...p.notes);
  return { action: Object.keys(fields).length === 0 ? "unchanged" : "update", fields, takeOver, unresolved, newBase, sentHash, notes, writes: [...writes] };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, n) => x === [...b].sort()[n]);
/** Hash of everything that is written but not compared (labels, due date, start date, priority, parent). */
export function extrasHash(fields: Record<string, unknown>): string {
  const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => !["summary", "description", "project", "issuetype"].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return sha(JSON.stringify(rest));
}
