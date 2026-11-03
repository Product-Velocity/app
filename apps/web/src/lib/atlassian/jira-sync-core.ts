import { createHash } from "node:crypto";
import { compareTexts, hashText, type TextVerdict } from "@pv/github";
import { adfToText, isSimpleAdf, markdownToAdf } from "./adf";
import { buildJiraPayload, type JiraFieldMap } from "./outbound";
import { cleanTitle } from "./read-issues";

// The decisions of "Sync with Jira" without any network or database (issue #67, #71): compare Product Velocity with the Jira issue three ways
// (the base is what both sides agreed at the last sync, hashes only), decide what goes out, what is taken over, and what is still a conflict.
// Pure, so the whole table is tested. Status is not an input anywhere (rule 6); nothing here can transition an issue.

export type PvItem = { id: string; name: string; description: string | null; moscow?: string | null; g2m_date_est?: string | null; planned_start?: string | null };
export type JiraNow = { summary: string; description: unknown; labels: string[] };
export type JiraBase = { title?: string; description?: string };
export type Side = "pv" | "jira";
export type TextField = "title" | "description";
export const COLUMN: Record<TextField, "initiative_name" | "description"> = { title: "initiative_name", description: "description" };
export const LABEL: Record<TextField, string> = { title: "Name", description: "Description" };

export type FieldCompare = { field: TextField; verdict: TextVerdict; pvText: string; jiraText: string; pvHash: string; jiraHash: string };

/** Opaque label for a created issue so a lost answer is found again (a hash, never the item id). */
export const markerFor = (itemId: string) => `pv:item/${createHash("sha256").update(`pv-jira-marker:${itemId}`).digest("hex").slice(0, 16)}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function compareJira(pv: PvItem, jira: JiraNow, base: JiraBase | null | undefined): { fields: FieldCompare[]; rich: boolean } {
  const pvTexts: Record<TextField, string> = { title: cleanTitle(pv.name), description: adfToText(markdownToAdf(pv.description ?? "")) };
  const jiraTexts: Record<TextField, string> = { title: cleanTitle(jira.summary), description: adfToText(jira.description) };
  const fields = (["title", "description"] as const).map((field): FieldCompare => {
    const pvHash = hashText(pvTexts[field]);
    const jiraHash = hashText(jiraTexts[field]);
    return { field, verdict: compareTexts(base?.[field], pvHash, jiraHash), pvText: pvTexts[field], jiraText: jiraTexts[field], pvHash, jiraHash };
  });
  return { fields, rich: jiraTexts.description !== "" && !isSimpleAdf(jira.description) };
}

export type Picks = Partial<Record<TextField, Side>>;
export type SendPlan = {
  action: "create" | "update" | "unchanged";
  /** The fields object for Jira (create or update); empty for "unchanged". */
  fields: Record<string, unknown>;
  /** Texts to take over from Jira into Product Velocity, by column. */
  takeOver: Partial<Record<"initiative_name" | "description", string>>;
  /** Fields of the two texts that are still conflicts for lack of a choice. */
  unresolved: TextField[];
  /** The agreed hashes after this sync (stored only after the write succeeded). */
  newBase: JiraBase;
  sentHash: string;
  notes: string[];
  /** Title and description that this plan writes. */
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
  create?: { projectKey: string; issueTypeId: string };
};

export function planJiraSend(i: PlanInput): SendPlan {
  const item = { initiative_name: i.pv.name, description: i.pv.description ?? "", moscow: i.pv.moscow ?? undefined, g2m_date_est: i.pv.g2m_date_est ?? undefined, planned_start: i.pv.planned_start ?? undefined };
  const marker = i.jira ? undefined : markerFor(i.pv.id);
  if (!i.jira) {
    const p = buildJiraPayload({ item, fields: i.map, ...(i.create ? { create: i.create } : {}), ...(marker ? { marker } : {}) });
    const c = compareJira(i.pv, { summary: i.pv.name, description: markdownToAdf(i.pv.description ?? ""), labels: [] }, null);
    return { action: "create", fields: p.fields, takeOver: {}, unresolved: [], newBase: { title: c.fields[0]!.pvHash, description: c.fields[1]!.pvHash }, sentHash: extrasHash(p.fields), notes: p.notes, writes: ["title", "description"] };
  }
  const cmp = compareJira(i.pv, i.jira, i.base);
  const writes: TextField[] = [];
  const takeOver: SendPlan["takeOver"] = {};
  const unresolved: TextField[] = [];
  const newBase: JiraBase = {};
  const notes: string[] = [];
  for (const f of cmp.fields) {
    const choice = i.picks?.[f.field];
    if (f.verdict === "none") { newBase[f.field] = f.pvHash; continue; }
    // verdict "github" = changed only in the tracker (here Jira), "both" = changed on both sides
    if (f.verdict === "send" || ((f.verdict === "github" || f.verdict === "both") && choice === "pv")) { writes.push(f.field); newBase[f.field] = f.pvHash; continue; }
    if (choice === "jira") { takeOver[COLUMN[f.field]] = f.jiraText; newBase[f.field] = f.jiraHash; continue; }
    unresolved.push(f.field);
  }
  const p = buildJiraPayload({ item, fields: i.map, currentLabels: i.jira.labels });
  const fields: Record<string, unknown> = { ...p.fields };
  if (!writes.includes("title")) delete fields.summary;
  if (!writes.includes("description")) delete fields.description;
  else if (cmp.rich) notes.push("The description in Jira has content Product Velocity cannot write back (a table, macro or mention). Sending replaces the whole description with Product Velocity's text.");
  // the parts that are written but not compared go out only when they changed since the last send, or when the labels in Jira are not as they should be
  const extras = { ...fields };
  delete extras.summary; delete extras.description;
  const sentHash = extrasHash(extras);
  const labelsOk = sameSet(i.jira.labels, (p.fields.labels as string[] | undefined) ?? []);
  if (sentHash === (i.sentHash ?? null) && labelsOk) for (const k of Object.keys(extras)) delete fields[k];
  notes.push(...p.notes);
  return { action: Object.keys(fields).length === 0 ? "unchanged" : "update", fields, takeOver, unresolved, newBase, sentHash, notes, writes };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, n) => x === [...b].sort()[n]);
/** Hash of everything that is written but not compared (labels, due date, start date, priority, parent). */
export function extrasHash(fields: Record<string, unknown>): string {
  const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => !["summary", "description", "project", "issuetype"].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return sha(JSON.stringify(rest));
}
