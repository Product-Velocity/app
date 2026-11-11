import { DEFAULT_NAMES, checkBlockWord, checkLabel, checkPrefix, validateNames, type LabelKind, type Names } from "@pv/github";
import { SLOT_BY_ID, defaultOn, slotsFor, type Slot, type Tracker } from "./slots";
import type { CatalogEntry } from "./catalog";
import type { JiraFieldMap } from "@/lib/atlassian/outbound";

// Saved field configuration (decision 2026-11-03-tracker-field-config): what a person changed for one connection (and one project), the rules a change must
// pass, and how it turns into the options the payload builders read. Pure. The database checks the same shapes again (tracker_set_field_config).
// A saved row names a slot of the closed list in slots.ts; nothing else can be stored, so a commercial field can not be mapped.

/** One saved choice. A slot with no row is at its default. */
export type ConfigRow = {
  slot: string; /** false = switched off: nothing is sent for it. */ enabled: boolean; /** A tracker field id for a "field" slot; null = the default field. */ field: string | null;
  /** Stealth mode (issue #411): the text of a label prefix, of the removed / define labels, of a marker, or of the base label. Absent or null = the default name. */
  text?: string | null;
};

/** Whether a slot carries a text a person can change. */
export const hasText = (s: Slot) => s.kind === "name" || s.nameKind !== undefined || s.id.endsWith(".label.base");
/** The name a slot's text has when nothing is saved (what the sync sends today). */
export function defaultText(s: Slot): string {
  if (s.nameKind) return DEFAULT_NAMES.prefix[s.nameKind];
  if (s.id.endsWith(".label.base")) return DEFAULT_NAMES.base;
  if (s.id.endsWith(".name.removed")) return DEFAULT_NAMES.removed;
  if (s.id.endsWith(".name.define")) return DEFAULT_NAMES.define;
  if (s.id.endsWith(".name.marker")) return DEFAULT_NAMES.jiraMarker;
  return DEFAULT_NAMES.block;
}
/** The check a text must pass for its slot (null = fine). The database checks the same shapes. */
export function textError(s: Slot, text: string): string | null {
  if (s.nameKind) return checkPrefix(text);
  if (s.id.endsWith(".name.block")) return checkBlockWord(text);
  if (s.id.endsWith(".name.marker")) return /^[A-Za-z0-9:_.-]{1,24}\/$/.test(text) ? null : "must be 2 to 25 characters and end in a slash";
  return checkLabel(text);
}

/** Slots switched off that are on by default (the labels, sections and dates a person can turn off). */
export const OFF = (rows: readonly ConfigRow[]): string[] => rows.filter((r) => !r.enabled && defaultOn(SLOT_BY_ID.get(r.slot)!)).map((r) => r.slot);
/** Slots switched on that are off by default (the optional labels, issue #321). */
export const ON_OPT = (rows: readonly ConfigRow[]): string[] => rows.filter((r) => r.enabled && !defaultOn(SLOT_BY_ID.get(r.slot)!)).map((r) => r.slot);

/** Stored rows to a clean list: unknown slots, fixed slots and malformed values are dropped (stored data is never trusted to have the right shape). */
export function parseConfigRows(raw: unknown, tracker: Tracker): ConfigRow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ConfigRow[] = [];
  for (const r of raw) {
    const o = typeof r === "object" && r !== null ? (r as Record<string, unknown>) : {};
    const s = typeof o.slot === "string" ? SLOT_BY_ID.get(o.slot) : undefined;
    if (!s || s.tracker !== tracker || s.kind === "fixed" || s.store !== "config" || seen.has(s.id)) continue;
    const enabled = o.enabled !== false && !(o.enabled === undefined && !defaultOn(s));
    const field = typeof o.field === "string" && o.field !== "" && s.kind === "field" && s.idPattern?.test(o.field) ? o.field : null;
    const text = hasText(s) && typeof o.text === "string" && o.text !== "" && textError(s, o.text) === null ? o.text : null;
    if (enabled === defaultOn(s) && field === null && text === null) continue; // the default: nothing to keep
    seen.add(s.id);
    out.push({ slot: s.id, enabled, field: enabled ? field : null, ...(text !== null ? { text } : {}) });
  }
  return out;
}

export type Validation = { ok: true; rows: ConfigRow[] } | { ok: false; errors: string[] };

/**
 * Checks a submitted configuration against the fields the tracker reports NOW. `catalog` is the list of fields read at save time (null = it could not be
 * read: a re-pointed field then can not be checked and is refused; switching things on or off still works).
 * Refused: an unknown, fixed or non-config slot; a field id that is not in the catalog; a field of a type the slot does not accept; two slots on one field.
 */
export function validateConfig(tracker: Tracker, submitted: readonly ConfigRow[], catalog: readonly CatalogEntry[] | null, other: { id: string; label: string }[] = []): Validation {
  const errors: string[] = [];
  const rows: ConfigRow[] = [];
  const used = new Map<string, string>();
  for (const o of other) used.set(o.id, o.label);
  const seen = new Set<string>();
  for (const r of submitted) {
    const s: Slot | undefined = SLOT_BY_ID.get(r.slot);
    if (!s || s.tracker !== tracker) { errors.push(`Unknown setting ${r.slot}.`); continue; }
    if (s.kind === "fixed") { errors.push(`${s.defaultTarget} can not be changed: ${s.fixedReason ?? "it is fixed"}`); continue; }
    if (s.store !== "config") { errors.push(`${s.id} is saved elsewhere.`); continue; }
    if (seen.has(s.id)) { errors.push(`${s.id} appears twice.`); continue; }
    seen.add(s.id);
    if (r.text !== undefined && r.text !== null && !hasText(s)) { errors.push(`${s.defaultTarget} has no text to change.`); continue; }
    if (r.text) { const e = textError(s, r.text); if (e) { errors.push(`The text for ${s.defaultTarget} ${e}.`); continue; } }
    if (s.kind === "name") {
      if (r.text) rows.push({ slot: s.id, enabled: true, field: null, text: r.text });
      continue;
    }
    if (s.kind === "toggle") {
      if (r.field !== null) { errors.push(`${s.defaultTarget} can only be switched on or off.`); continue; }
      if (r.enabled !== defaultOn(s) || r.text) rows.push({ slot: s.id, enabled: r.enabled, field: null, ...(r.text ? { text: r.text } : {}) });
      continue;
    }
    if (!r.enabled) { rows.push({ slot: s.id, enabled: false, field: null }); continue; }
    if (r.field === null || r.field === s.defaultFieldId) { if (s.defaultFieldId) used.set(s.defaultFieldId, s.id); continue; }
    if (!s.idPattern?.test(r.field)) { errors.push(`${r.field} is not a valid field id for ${s.defaultTarget}.`); continue; }
    const entry = catalog?.find((c) => c.id === r.field);
    if (!catalog) { errors.push("The fields of the tracker could not be read just now, so the change could not be checked. Try again in a minute."); continue; }
    if (!entry) { errors.push(`The field ${r.field} does not exist in the tracker any more.`); continue; }
    if (!s.accepts?.includes(entry.kind)) { errors.push(`${entry.name} is a ${entry.typeLabel.toLowerCase()} field; ${s.defaultTarget} needs a ${s.accepts?.join(" or ")} field.`); continue; }
    const clash = used.get(r.field);
    if (clash) { errors.push(`${entry.name} is already used for ${clash}. One tracker field can hold one Product Velocity field.`); continue; }
    used.set(r.field, s.id);
    rows.push({ slot: s.id, enabled: true, field: r.field });
  }
  if (errors.length === 0) errors.push(...validateNames(namesFromRows(rows, tracker)));
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

/**
 * The names stealth mode saved (label prefixes, base, removed and define labels, the marker, hiding the brand) from the rows of one tracker. Absent = default,
 * so with no rows the builders send exactly what they always did.
 */
export function namesFromRows(rows: readonly ConfigRow[], tracker: Tracker): Names {
  const prefix: Partial<Record<LabelKind, string>> = {};
  const n: Names = {};
  for (const r of rows) {
    const s = SLOT_BY_ID.get(r.slot);
    if (!s || s.tracker !== tracker) continue;
    if (s.nameKind) { if (r.text) prefix[s.nameKind] = r.text; continue; }
    if (s.id === `${tracker}.label.base`) { if (!r.enabled) n.base = ""; else if (r.text) n.base = r.text; continue; }
    if (s.id === `${tracker}.name.removed` && r.text) n.removed = r.text;
    else if (s.id === `${tracker}.name.define` && r.text) n.define = r.text;
    else if (s.id === "jira.name.marker" && r.text) n.jiraMarker = r.text;
    else if (s.id === "github.name.block" && r.text) n.block = r.text;
    else if (s.id === `${tracker}.hideBrand` && r.enabled) n.hideBrand = true;
  }
  if (Object.keys(prefix).length > 0) n.prefix = prefix;
  return n;
}
export const hasNames = (n: Names) => Object.keys(n).length > 0;

/** The Jira map the sender reads: the stored field map (start date, theme, priorities) plus the new slots (due date field, switched-off slots). */
export function effectiveJiraMap(base: JiraFieldMap, rows: readonly ConfigRow[]): JiraFieldMap {
  const out: JiraFieldMap = { ...base };
  const due = rows.find((r) => r.slot === "jira.dueDate");
  if (due?.enabled && due.field) out.dueDate = due.field;
  const off = OFF(rows).filter((s) => s.startsWith("jira."));
  if (off.length > 0) out.off = off;
  const on = ON_OPT(rows).filter((s) => s.startsWith("jira."));
  if (on.length > 0) out.on = on;
  const names = namesFromRows(rows, "jira");
  if (hasNames(names)) out.names = names;
  return out;
}

/** What the GitHub builder reads: the slots switched off. */
export type GithubSendOptions = { off?: readonly string[]; on?: readonly string[]; names?: Names };
export const githubOptions = (rows: readonly ConfigRow[]): GithubSendOptions => {
  const off = OFF(rows).filter((s) => s.startsWith("github."));
  const on = ON_OPT(rows).filter((s) => s.startsWith("github."));
  const names = namesFromRows(rows, "github");
  return { ...(off.length > 0 ? { off } : {}), ...(on.length > 0 ? { on } : {}), ...(hasNames(names) ? { names } : {}) };
};

/** Slots whose saved value lives in the config table, for one tracker. */
export const configSlots = (t: Tracker) => slotsFor(t).filter((s) => s.store === "config" && s.kind !== "fixed");
