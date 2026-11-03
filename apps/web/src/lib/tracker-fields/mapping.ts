import { SLOT_BY_ID, slotsFor, type Slot, type Tracker } from "./slots";
import type { CatalogEntry } from "./catalog";
import type { JiraFieldMap } from "@/lib/atlassian/outbound";

// Saved field configuration (decision 2026-11-03-tracker-field-config): what a person changed for one connection (and one project), the rules a change must
// pass, and how it turns into the options the payload builders read. Pure. The database checks the same shapes again (tracker_set_field_config).
// A saved row names a slot of the closed list in slots.ts; nothing else can be stored, so a commercial field can not be mapped.

/** One saved choice. A slot with no row is at its default. */
export type ConfigRow = { slot: string; /** false = switched off: nothing is sent for it. */ enabled: boolean; /** A tracker field id for a "field" slot; null = the default field. */ field: string | null };

export const OFF = (rows: readonly ConfigRow[]): string[] => rows.filter((r) => !r.enabled).map((r) => r.slot);

/** Stored rows to a clean list: unknown slots, fixed slots and malformed values are dropped (stored data is never trusted to have the right shape). */
export function parseConfigRows(raw: unknown, tracker: Tracker): ConfigRow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ConfigRow[] = [];
  for (const r of raw) {
    const o = typeof r === "object" && r !== null ? (r as Record<string, unknown>) : {};
    const s = typeof o.slot === "string" ? SLOT_BY_ID.get(o.slot) : undefined;
    if (!s || s.tracker !== tracker || s.kind === "fixed" || s.store !== "config" || seen.has(s.id)) continue;
    const enabled = o.enabled !== false;
    const field = typeof o.field === "string" && o.field !== "" && s.kind === "field" && s.idPattern?.test(o.field) ? o.field : null;
    if (enabled && field === null) continue; // the default: nothing to keep
    seen.add(s.id);
    out.push({ slot: s.id, enabled, field: enabled ? field : null });
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
    if (s.kind === "toggle") {
      if (r.field !== null) { errors.push(`${s.defaultTarget} can only be switched on or off.`); continue; }
      if (!r.enabled) rows.push({ slot: s.id, enabled: false, field: null });
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
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

/** The Jira map the sender reads: the stored field map (start date, theme, priorities) plus the new slots (due date field, switched-off slots). */
export function effectiveJiraMap(base: JiraFieldMap, rows: readonly ConfigRow[]): JiraFieldMap {
  const out: JiraFieldMap = { ...base };
  const due = rows.find((r) => r.slot === "jira.dueDate");
  if (due?.enabled && due.field) out.dueDate = due.field;
  const off = OFF(rows).filter((s) => s.startsWith("jira."));
  if (off.length > 0) out.off = off;
  return out;
}

/** What the GitHub builder reads: the slots switched off. */
export type GithubSendOptions = { off?: readonly string[] };
export const githubOptions = (rows: readonly ConfigRow[]): GithubSendOptions => {
  const off = OFF(rows).filter((s) => s.startsWith("github."));
  return off.length > 0 ? { off } : {};
};

/** Slots whose saved value lives in the config table, for one tracker. */
export const configSlots = (t: Tracker) => slotsFor(t).filter((s) => s.store === "config" && s.kind !== "fixed");
