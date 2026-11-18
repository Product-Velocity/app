import { createHash } from "node:crypto";
import { compareTexts, hashText, resolveNames, type TextVerdict } from "@pv/github";
import { adfToText, markdownToAdf, type AdfNode } from "./adf";
import { LINK_SECTIONS, TEXT_SECTIONS, attachmentsHash, attachmentsText, composeDescription, linksText, isSimpleNodes, nodesText, splitDescription, type Link, type Split, type TextSection } from "./jira-sections";
import { buildJiraPayload, type JiraFieldMap } from "./outbound";
import { cleanTitle } from "./read-issues";
import { SELECT_SLOTS, compareSelect, readSelectValue } from "./select-map";

// The decisions of "Sync with Jira" without any network or database (issue #67, #71): compare Product Velocity with the Jira issue three ways
// (the base is what both sides agreed at the last sync, hashes only), decide what goes out, what is taken over, and what is still a conflict.
// Pure, so the whole table is tested. Status is not an input anywhere (rule 6); nothing here can transition an issue.

export type PvItem = { focus_area?: string | null; value_type?: string | null; g2m_quarter?: string | null; tags?: string[]; id: string; name: string; summary?: string | null; description: string | null; hypothesis?: string | null; moscow?: string | null; g2m_date_est?: string | null; planned_start?: string | null; stack_rank?: number | null; change_type?: string | null; theme?: string | null; health?: string | null; initiative_status?: string | null; initiative_phase?: string | null };
export type JiraNow = { summary: string; description: unknown; labels: string[] };
/** Hashes both sides agreed on at the last sync. `attachments` is the hash of the Artifacts and Files sections as last written. */
export type JiraBase = { title?: string; summary?: string; description?: string; hypothesis?: string; attachments?: string; /** The Product Velocity value of each select field both sides agreed on at the last sync (issue #512). */ sel_health?: string; sel_initiative_status?: string; sel_initiative_phase?: string };
export type Side = "pv" | "jira";
/** The compared texts: the name (the Jira summary) and the three sections of the description. */
export type TextField = "title" | TextSection;
export const TEXT_FIELDS: readonly TextField[] = ["title", ...TEXT_SECTIONS];
export const COLUMN: Record<TextField, "initiative_name" | "summary" | "description" | "hypothesis"> = { title: "initiative_name", summary: "summary", description: "description", hypothesis: "hypothesis" };
export const LABEL: Record<TextField, string> = { title: "Name", summary: "Summary", description: "Description", hypothesis: "Hypothesis" };

export type FieldCompare = { field: TextField; verdict: TextVerdict; pvText: string; jiraText: string; pvHash: string; jiraHash: string };

/** Opaque label for a created issue so a lost answer is found again (a hash, never the item id). */
export const markerFor = (itemId: string, prefix = "pm:item/") => `${prefix}${createHash("sha256").update(`pv-jira-marker:${itemId}`).digest("hex").slice(0, 16)}`;
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
  /** On create: the opaque label that finds the issue again after a lost answer (its prefix is a stealth-mode name). */
  marker?: string;
  notes: string[];
  /** The texts that this plan writes (the three sections are written together, as one description). */
  writes: TextField[];
  /** Select fields (issue #512): Jira values the person chose to take over, the differences to show, and the ones still waiting for a choice. */
  selectTakeOver: Partial<Record<SelectKey, string>>;
  selectConflicts: SelectConflict[];
  unresolvedSelects: SelectKey[];
};
export type SelectKey = "health" | "initiative_status";
export type SelectConflict = { pvKey: SelectKey; label: string; verdict: "jira" | "both"; pv: string; jira: string; jiraHash: string };

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
  /** The documents left shared, each as a name and a public link, for the Documents section. */
  documents?: Link[];
  /** The raw value of each mapped select field on the Jira issue now, by slot id (issue #512). */
  selectsNow?: Record<string, unknown>;
  /** What the person chose for a select field that differs: "jira" takes Jira's value over, "pv" writes Product Velocity's. */
  selectPicks?: Partial<Record<SelectKey, Side>>;
};

export function planJiraSend(i: PlanInput): SendPlan {
  const item = { initiative_name: i.pv.name, summary: i.pv.summary ?? "", description: i.pv.description ?? "", hypothesis: i.pv.hypothesis ?? "", moscow: i.pv.moscow ?? undefined, g2m_date_est: i.pv.g2m_date_est ?? undefined, planned_start: i.pv.planned_start ?? undefined, stack_rank: i.pv.stack_rank ?? undefined, change_type: i.pv.change_type ?? undefined, theme: i.pv.theme ?? undefined, focus_area: i.pv.focus_area ?? undefined, value_type: i.pv.value_type ?? undefined, g2m_quarter: i.pv.g2m_quarter ?? undefined, tags: i.pv.tags ?? [], health: i.pv.health ?? undefined, initiative_status: i.pv.initiative_status ?? undefined, initiative_phase: i.pv.initiative_phase ?? undefined };
  const marker = i.jira ? undefined : markerFor(i.pv.id, resolveNames(i.map.names).jiraMarker);
  const shown = { ...(i.map.off?.includes("jira.body.artifacts") ? {} : { artifacts: i.artifacts }), ...(i.map.off?.includes("jira.body.files") ? {} : { files: i.files }) };
  const attHash = attachmentsHash(shown.artifacts, shown.files, i.documents);
  const payloadInput = { item, fields: i.map, ...(i.projectName ? { projectName: i.projectName } : {}), ...(i.artifacts ? { artifacts: i.artifacts } : {}), ...(i.files ? { files: i.files } : {}), ...(i.documents ? { documents: i.documents } : {}) };
  if (!i.jira) {
    const p = buildJiraPayload({ ...payloadInput, ...(i.create ? { create: i.create } : {}), ...(marker ? { marker } : {}) });
    const c = compareJira(i.pv, { summary: i.pv.name, description: null, labels: [] }, null);
    const newBase: JiraBase = { attachments: attHash };
    for (const f of c.fields) newBase[f.field] = f.pvHash;
    for (const s of SELECT_SLOTS) { const cfg = i.map.selects?.[s.slot]; const v = i.pv[s.pvKey]; if (cfg && v && cfg.options[v]) newBase[`sel_${s.pvKey}`] = v; }
    return { action: "create", selectTakeOver: {}, selectConflicts: [], unresolvedSelects: [], fields: p.fields, takeOver: {}, unresolved: [], newBase, sentHash: extrasHash(p.fields), ...(marker ? { marker } : {}), notes: p.notes, writes: [...TEXT_FIELDS] };
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
  // Links, Files and Documents are dirty when the record of the last send differs OR when what Jira shows now is not what would be written: a record that
  // says "sent" must never hide a description that still has the old content (SCRUM-9, 2026-11-06)
  const want: Record<(typeof LINK_SECTIONS)[number], string> = { artifacts: linksText(shown.artifacts), files: linksText(shown.files), documents: linksText(i.documents) };
  const shownInJira = LINK_SECTIONS.some((k) => nodesText(cmp.split.sent[k]) !== want[k]);
  const attachmentsDirty = shownInJira || (i.base?.attachments === undefined ? attachmentsText(shown.artifacts, shown.files, i.documents) !== "" : i.base.attachments !== attHash);
  let wroteDescription = false;
  const unresolvedSection = unresolved.some((f) => f !== "title");
  if ((sectionWrites.length > 0 || attachmentsDirty) && !unresolvedSection) {
    const keep: Partial<Record<TextSection, AdfNode[]>> = {};
    for (const k of TEXT_SECTIONS) if (!sectionWrites.includes(k)) keep[k] = cmp.split.nodes[k] ?? [];
    wroteDescription = true;
    fields.description = composeDescription({ pv: { summary: i.pv.summary ?? "", description: i.pv.description ?? "", hypothesis: i.pv.hypothesis ?? "" }, keep, head: cmp.split.head, ...shown, ...(i.documents ? { documents: i.documents } : {}) });
    const lost = sectionWrites.filter((k) => cmp.richIn.includes(k));
    if (lost.length > 0) notes.push(`The ${lost.map((k) => LABEL[k]).join(" and ")} in Jira has content Product Velocity cannot write back (a table, macro or mention). Sending replaces ${lost.length > 1 ? "those sections" : "that section"} with Product Velocity's text.`);
    if (cmp.split.legacy && sectionWrites.length > 0 && cmp.split.nodes.description) notes.push("The Jira description gets headed sections (Summary, Description, Hypothesis, Artifacts, Files), like the GitHub issue.");
  } else delete fields.description;
  // the record of the sent-only sections moves only when they were written; if a rewrite was needed but did not happen, it stays, so the next sync tries again
  if (attachmentsDirty && !wroteDescription) { if (i.base?.attachments !== undefined) newBase.attachments = i.base.attachments; else delete newBase.attachments; }
  const forced: Record<string, unknown> = {}; // select fields that must be written even though the hash says "already sent"
  // select fields (issue #512): Jira's own change is a proposal, never overwritten and never applied without a person's choice
  const sels = planSelects(i, fields, newBase, notes, forced);
  // the parts that are written but not compared go out only when they changed since the last send, or when the labels in Jira are not as they should be
  const extras = { ...fields };
  delete extras.summary; delete extras.description;
  const sentHash = extrasHash(extras);
  const labelsOk = sameSet(i.jira.labels, (p.fields.labels as string[] | undefined) ?? []);
  if (sentHash === (i.sentHash ?? null) && labelsOk) for (const k of Object.keys(extras)) delete fields[k];
  Object.assign(fields, forced);
  notes.push(...p.notes);
  return { action: Object.keys(fields).length === 0 ? "unchanged" : "update", fields, takeOver, unresolved, newBase, sentHash, notes, writes: [...writes], ...sels };
}

/** The select fields of an existing issue: decides, per mapped slot, what is sent, what is taken over and what waits for a person. Edits `fields` and `newBase` in place. */
function planSelects(i: PlanInput, fields: Record<string, unknown>, newBase: JiraBase, notes: string[], forced: Record<string, unknown>): Pick<SendPlan, "selectTakeOver" | "selectConflicts" | "unresolvedSelects"> {
  const selectTakeOver: SendPlan["selectTakeOver"] = {};
  const selectConflicts: SelectConflict[] = [];
  const unresolvedSelects: SelectKey[] = [];
  for (const s of SELECT_SLOTS) {
    const cfg = i.map.selects?.[s.slot];
    if (!cfg) continue;
    const baseKey = `sel_${s.pvKey}` as const;
    const pvVal = i.pv[s.pvKey] ?? null;
    const mapped = pvVal !== null && pvVal !== "" && cfg.options[pvVal] !== undefined;
    // Initiative Phase only goes to Jira (it is moved at the decision gates), and so does every slot set to "to_jira"
    if (cfg.direction === "to_jira" || s.pvKey === "initiative_phase") {
      if (mapped) { newBase[baseKey] = pvVal!; const now = readSelectValue(cfg, i.selectsNow?.[s.slot]); if (now.kind !== "value" || now.value !== pvVal) forced[cfg.field] = fields[cfg.field]; }
      continue;
    }
    const key = s.pvKey as SelectKey;
    const read = readSelectValue(cfg, i.selectsNow?.[s.slot]);
    if (read.kind === "unmapped") { delete fields[cfg.field]; notes.push(`${s.label} not sent: Jira holds “${read.name}”, which no Product Velocity value stands for, so it is left as it is.`); continue; }
    const jiraVal = read.kind === "value" ? read.value : null;
    const verdict = compareSelect({ base: i.base?.[baseKey], pv: pvVal, jira: jiraVal });
    if (verdict === "none" || verdict === "send") { if (mapped) newBase[baseKey] = pvVal!; else if (jiraVal !== null && verdict === "none") newBase[baseKey] = jiraVal; continue; }
    const choice = i.selectPicks?.[key];
    selectConflicts.push({ pvKey: key, label: s.label, verdict, pv: pvVal ?? "", jira: jiraVal!, jiraHash: createHash("sha256").update(jiraVal!).digest("hex") });
    if (choice === "jira") { selectTakeOver[key] = jiraVal!; newBase[baseKey] = jiraVal!; delete fields[cfg.field]; }
    else if (choice === "pv" && mapped) { newBase[baseKey] = pvVal!; forced[cfg.field] = fields[cfg.field]; }
    else { delete fields[cfg.field]; if (choice !== "pv") unresolvedSelects.push(key); }
  }
  return { selectTakeOver, selectConflicts, unresolvedSelects };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, n) => x === [...b].sort()[n]);
/** Hash of everything that is written but not compared (labels, due date, start date, priority, parent). */
export function extrasHash(fields: Record<string, unknown>): string {
  const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => !["summary", "description", "project", "issuetype"].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return sha(JSON.stringify(rest));
}
