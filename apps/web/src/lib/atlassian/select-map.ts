import { FIELD_BY_KEY } from "@pv/domain";
import { fieldKind, type JiraField } from "./field-catalog";

// Issue #512 (decision 2026-11-18-jira-initiative-fields): Health, Initiative Status and Initiative Phase mapped to CUSTOM SINGLE-SELECT fields of the
// Jira issue that is the initiative, per project: which Jira field, which Jira option stands for each Product Velocity value, and the direction.
// Pure functions, no network. The list of slots is closed. Initiative Phase only ever goes to Jira: a move past a decision gate is refused by the
// database (PV006), so Jira can never set it. What comes back from Jira is only ever a PROPOSAL a person accepts (never applied silently).

export type SelectDirection = "to_jira" | "two_way";
export type SelectSlot = { slot: string; pvKey: "health" | "initiative_status" | "initiative_phase"; label: string; values: readonly string[]; directions: readonly SelectDirection[] };
const values = (k: string): readonly string[] => FIELD_BY_KEY[k]?.allowed ?? [];

export const SELECT_SLOTS: readonly SelectSlot[] = [
  { slot: "jira.select.health", pvKey: "health", label: "Health", values: values("health"), directions: ["to_jira", "two_way"] },
  { slot: "jira.select.initiative_status", pvKey: "initiative_status", label: "Initiative Status", values: values("initiative_status"), directions: ["to_jira", "two_way"] },
  { slot: "jira.select.initiative_phase", pvKey: "initiative_phase", label: "Initiative Phase", values: values("initiative_phase"), directions: ["to_jira"] },
];
const SLOT_BY_ID = new Map(SELECT_SLOTS.map((s) => [s.slot, s]));

export const SELECT_FIELD_ID = /^customfield_\d{1,9}$/;
export const OPTION_ID = /^\d{1,12}$/;

export type SelectConfig = { field: string; direction: SelectDirection; /** Product Velocity value -> Jira option id. A value that is not here is not sent. */ options: Record<string, string> };
export type SelectMap = Partial<Record<string, SelectConfig>>;

/** A stored mapping to what the sender uses; anything malformed is dropped, so a bad value can never reach a Jira request. */
export function parseSelectMap(raw: unknown): SelectMap {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: SelectMap = {};
  for (const s of SELECT_SLOTS) {
    const c = o[s.slot];
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    if (typeof r.field !== "string" || !SELECT_FIELD_ID.test(r.field)) continue;
    if (r.direction !== "to_jira" && r.direction !== "two_way") continue;
    const direction: SelectDirection = s.directions.includes("two_way") && r.direction === "two_way" ? "two_way" : "to_jira";
    const opts = typeof r.options === "object" && r.options !== null ? (r.options as Record<string, unknown>) : {};
    const options: Record<string, string> = {};
    const used = new Set<string>();
    for (const v of s.values) {
      const id = opts[v];
      if (typeof id !== "string" || !OPTION_ID.test(id)) continue;
      if (direction === "two_way" && used.has(id)) continue; // the way back would be ambiguous: the first value keeps the option
      used.add(id);
      options[v] = id;
    }
    out[s.slot] = { field: r.field, direction, options };
  }
  return out;
}

/** What a person can still fix in the form: the Jira field and its options must exist on the site; one Jira field serves one Product Velocity field. */
export function validateSelectMap(map: SelectMap, siteOptions: ReadonlyMap<string, readonly string[]>): string[] {
  const errors: string[] = [];
  const usedBy = new Map<string, string>();
  for (const [slot, c] of Object.entries(map)) {
    if (!c) continue;
    const label = SLOT_BY_ID.get(slot)?.label ?? slot;
    const ids = siteOptions.get(c.field);
    if (!ids) { errors.push(`${label}: the Jira field ${c.field} does not exist on this site or is not a single select.`); continue; }
    const prior = usedBy.get(c.field);
    if (prior) errors.push(`${label}: the Jira field ${c.field} is already used for ${prior}.`);
    else usedBy.set(c.field, label);
    for (const [value, id] of Object.entries(c.options)) if (!ids.includes(id)) errors.push(`${label}: the option ${id} chosen for ${value} does not exist on the Jira field ${c.field}.`);
  }
  return errors;
}

/** Custom single-select fields of the site (radio buttons and cascading selects are not offered: Jira writes them differently). */
export function selectChoices(fields: readonly Pick<JiraField, "id" | "name" | "custom" | "schema">[]): { id: string; name: string }[] {
  return fields
    .filter((f) => f.custom && SELECT_FIELD_ID.test(f.id) && fieldKind(f.schema) === "select" && !(f.schema?.custom ?? "").endsWith(":cascadingselect") && !(f.schema?.custom ?? "").endsWith(":radiobuttons"))
    .map((f) => ({ id: f.id, name: f.name.slice(0, 100) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Product Velocity to Jira: the option id of each mapped slot's current value. A value with no option is left out and the preview says so. */
export function selectsPayload(item: Partial<Record<string, string | null | undefined>>, map: SelectMap): { fields: Record<string, { id: string }>; notes: string[] } {
  const fields: Record<string, { id: string }> = {};
  const notes: string[] = [];
  for (const s of SELECT_SLOTS) {
    const c = map[s.slot];
    if (!c) continue;
    const v = item[s.pvKey];
    if (typeof v !== "string" || v === "") continue;
    const id = c.options[v];
    if (id && OPTION_ID.test(id) && SELECT_FIELD_ID.test(c.field)) fields[c.field] = { id };
    else notes.push(`${s.label} not sent: no Jira option is chosen for “${v.slice(0, 40)}”.`);
  }
  return { fields, notes };
}

export type SelectRead = { kind: "value"; value: string } | { kind: "unmapped"; name: string } | { kind: "empty" };
/** Jira to Product Velocity: the Product Velocity value a Jira option stands for, by option id. */
export function readSelectValue(c: SelectConfig, jira: unknown): SelectRead {
  if (typeof jira !== "object" || jira === null) return { kind: "empty" };
  const o = jira as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  const name = typeof o.value === "string" ? o.value.slice(0, 80) : "";
  const hit = id ? Object.entries(c.options).find(([, v]) => v === id) : undefined;
  if (hit) return { kind: "value", value: hit[0] };
  return name || id ? { kind: "unmapped", name: name || (id as string) } : { kind: "empty" };
}

export type SelectVerdict = "none" | "send" | "jira" | "both";
/** Three-way: `base` is the Product Velocity value both sides agreed on at the last sync. `jira` is the Product Velocity value the Jira option stands for (null: empty or unmapped). */
export function compareSelect(i: { base: string | null | undefined; pv: string | null | undefined; jira: string | null | undefined }): SelectVerdict {
  const pv = i.pv ?? null;
  const jira = i.jira ?? null;
  if (jira === null || pv === jira) return "none";
  if (i.base === undefined) return pv === null ? "jira" : "both"; // Product Velocity has nothing to lose when it is empty
  const base = i.base ?? null;
  const pvChanged = pv !== base;
  const jiraChanged = jira !== base;
  if (pvChanged && jiraChanged) return "both";
  if (pvChanged) return "send";
  if (jiraChanged) return "jira";
  return "none";
}

/** The rows of jira_select_map to the shape parseSelectMap reads. */
export function selectRowsToMap(rows: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = typeof r === "object" && r !== null ? (r as Record<string, unknown>) : {};
    if (typeof o.slot === "string") out[o.slot] = { field: o.field_id, direction: o.direction, options: o.options };
  }
  return out;
}
