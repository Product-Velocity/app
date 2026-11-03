import { FIELD_BY_KEY, JIRA_DIRECTIONS, JIRA_KINDS, validateJiraMapping, type JiraDirection, type JiraFieldMapping, type JiraKind } from "@pv/domain";
import type { CatalogRow } from "./field-catalog";

// Loading what an admin mapped (docs/16 point 3, issue #70), for the two sync sessions: the read side (Jira values into initiatives) and the
// write side (what is sent to Jira). This slice only STORES and validates the mapping; reading and sending use these helpers.
//
//   const m = await loadFieldMappings(supabase, link.id);   // as the signed-in person: members can read mappings
//   for (const x of m.readable) { const v = readJiraValue(x.jiraKind, issue.fields[x.jiraFieldId]); ... set x.pvField ... }
//   for (const x of m.writable) { const v = toJiraValue({ id: x.jiraFieldId, custom: x.jiraCustom, kind: x.jiraKind }, item[x.pvField]); ... }
//
// Every row is checked again against the shared rules, so a row the rules no longer allow is dropped here and never reaches a Jira request.
// Unmapped fields are not in the list: nothing is read or written for them.

export type LoadedMapping = JiraFieldMapping & { jiraCustom: boolean };
export type LoadedMappings = {
  /** Every valid mapping of the link, Jira field id order. */
  all: LoadedMapping[];
  /** Jira -> PV: every mapping (read only and two-way both read). */
  readable: LoadedMapping[];
  /** PV -> Jira: the two-way mappings only. */
  writable: LoadedMapping[];
  byJiraField: ReadonlyMap<string, LoadedMapping>;
  byPvField: ReadonlyMap<string, LoadedMapping>;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Rows of jira_field_mappings to valid mappings; anything malformed or no longer allowed is dropped. */
export function parseMappingRows(rows: unknown): LoadedMapping[] {
  if (!Array.isArray(rows)) return [];
  const seenJira = new Set<string>();
  const seenPv = new Set<string>();
  const out: LoadedMapping[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const { jira_field_id: id, jira_field_name: name, jira_kind: kind, jira_custom: custom, pv_field: pv, direction } = r;
    if (typeof id !== "string" || typeof name !== "string" || typeof kind !== "string" || typeof pv !== "string" || typeof direction !== "string") continue;
    if (!(JIRA_KINDS as readonly string[]).includes(kind) || !(JIRA_DIRECTIONS as readonly string[]).includes(direction) || !FIELD_BY_KEY[pv]) continue;
    const isCustom = custom === true;
    if (!validateJiraMapping({ id, custom: isCustom, kind }, pv, direction).ok) continue;
    if (seenJira.has(id) || seenPv.has(pv)) continue; // one to one
    seenJira.add(id);
    seenPv.add(pv);
    out.push({ jiraFieldId: id, jiraFieldName: name, jiraKind: kind as JiraKind, pvField: pv, direction: direction as JiraDirection, jiraCustom: isCustom });
  }
  return out.sort((a, b) => a.jiraFieldId.localeCompare(b.jiraFieldId));
}

export function toLoadedMappings(rows: unknown): LoadedMappings {
  const all = parseMappingRows(rows);
  return {
    all,
    readable: all,
    writable: all.filter((m) => m.direction === "two_way"),
    byJiraField: new Map(all.map((m) => [m.jiraFieldId, m])),
    byPvField: new Map(all.map((m) => [m.pvField, m])),
  };
}

/** The smallest part of a Supabase client the loader needs, so a test can pass a fake. */
export type MappingReader = {
  from(table: "jira_field_mappings"): { select(columns: string): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
};
const COLUMNS = "jira_field_id, jira_field_name, jira_kind, jira_custom, pv_field, direction";

/** The mappings of one project link. Throws when the database cannot be read (an empty list means "nothing mapped", never "unknown"). */
export async function loadFieldMappings(db: MappingReader, linkId: string): Promise<LoadedMappings> {
  const { data, error } = await db.from("jira_field_mappings").select(COLUMNS).eq("link_id", linkId);
  if (error) throw new Error("Could not read the Jira field mapping");
  return toLoadedMappings(data);
}

/** The cached catalog rows (jsonb) back to rows, defensively: a cache written by an older version must not break the page. */
export function parseCatalogRows(raw: unknown): CatalogRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogRow[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== "string" || typeof r.name !== "string" || typeof r.kind !== "string") continue;
    out.push({
      id: r.id, name: r.name, custom: r.custom === true,
      kind: ((JIRA_KINDS as readonly string[]).includes(r.kind) ? r.kind : "other") as JiraKind,
      role: typeof r.role === "string" ? (r.role as CatalogRow["role"]) : null,
      filled: Number.isFinite(r.filled) ? Number(r.filled) : 0,
      sampled: Number.isFinite(r.sampled) ? Number(r.sampled) : 0,
    });
  }
  return out;
}
