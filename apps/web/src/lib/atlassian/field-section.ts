import { FIELD_BY_KEY, JIRA_ALWAYS_SYNCED_IDS, JIRA_UNMAPPABLE_IDS, kindWords, suggestMapping, targetsForJira, type JiraDirection, type JiraKind } from "@pv/domain";
import type { CatalogRow } from "./field-catalog";
import type { LoadedMapping } from "./field-mappings";

// What the "Fields" section of a linked Jira project shows (issues #69, #70). Pure: the page passes the cached catalog and the stored mappings.

export type FieldTargetView = { value: string; label: string };
export type FieldRowView = {
  id: string;
  name: string;
  custom: boolean;
  kind: JiraKind;
  kindText: string;
  role: string | null;
  filled: number;
  sampled: number;
  /** Where it is mapped now, or null: unmapped fields are ignored. */
  mapped: { pv: string; pvLabel: string; direction: JiraDirection; value: string } | null;
  /** A proposal from the role hint; shown as a hint, never applied. */
  suggestion: { pv: string; pvLabel: string; direction: JiraDirection; value: string } | null;
  /** The choices for the picker (value is `pv:direction`). Empty when nothing can take this field. */
  targets: FieldTargetView[];
  /** Why nothing can take it, when `targets` is empty. */
  unmappableReason: string | null;
  /** A mapping whose Jira field is not in the last catalog read (renamed, deleted, or the catalog is old). */
  missing: boolean;
};
export type FieldsView = {
  refreshedAt: string | null;
  error: string | null;
  sampled: number;
  rows: FieldRowView[];
  mappedCount: number;
  /** The list was read more than STALE_DAYS ago. */
  stale: boolean;
};
export const STALE_DAYS = 7;

const ROLE_TEXT: Record<string, string> = {
  story_points: "Story points", start_date: "Start date", due_date: "Due date", sprint: "Sprint", team: "Team", labels: "Labels", priority: "Priority",
  assignee: "Assignee", parent: "Parent", epic_link: "Epic link",
};
export const roleText = (role: string | null) => (role ? (ROLE_TEXT[role] ?? role) : null);
const DIRECTION_TEXT: Record<JiraDirection, string> = { read: "read only", two_way: "two-way" };
export const directionText = (d: JiraDirection) => DIRECTION_TEXT[d];
const pvName = (k: string) => FIELD_BY_KEY[k]?.name ?? k;
const choice = (pv: string, direction: JiraDirection) => ({ pv, pvLabel: pvName(pv), direction, value: `${pv}:${direction}` });

function reasonNothingTakes(row: { id: string; kind: JiraKind }): string {
  if ((JIRA_ALWAYS_SYNCED_IDS as readonly string[]).includes(row.id)) return "The title and description are always synced, so they are not mapped.";
  if ((JIRA_UNMAPPABLE_IDS as readonly string[]).includes(row.id)) return "A Jira status, resolution or computed field is never mapped.";
  if (row.kind === "other") return "Product Velocity cannot read this kind of value yet.";
  return `No Product Velocity field takes ${kindWords(row.kind)}.`;
}

export function buildFieldsView(input: { rows: CatalogRow[]; mappings: LoadedMapping[]; refreshedAt: string | null; error: string | null; sampled: number; now?: number }): FieldsView {
  const byId = new Map(input.mappings.map((m) => [m.jiraFieldId, m]));
  const toRow = (r: CatalogRow, missing = false): FieldRowView => {
    const ref = { id: r.id, custom: r.custom, kind: r.kind };
    const m = byId.get(r.id);
    const s = suggestMapping({ ...ref, role: r.role });
    const targets = targetsForJira(ref).flatMap((t) => t.directions.map((d) => ({ value: `${t.pv}:${d}`, label: `${pvName(t.pv)} (${directionText(d)})` })));
    return {
      id: r.id, name: r.name, custom: r.custom, kind: r.kind, kindText: kindWords(r.kind), role: roleText(r.role), filled: r.filled, sampled: r.sampled,
      mapped: m ? choice(m.pvField, m.direction) : null,
      suggestion: s && !m ? choice(s.pv, s.direction) : null,
      targets, unmappableReason: targets.length === 0 ? reasonNothingTakes(ref) : null, missing,
    };
  };
  const rows = input.rows.map((r) => toRow(r));
  // a mapping whose Jira field is no longer in the catalog stays visible, so an admin can remove it
  for (const m of input.mappings) {
    if (!input.rows.some((r) => r.id === m.jiraFieldId)) rows.push(toRow({ id: m.jiraFieldId, name: m.jiraFieldName, custom: m.jiraCustom, kind: m.jiraKind, role: null, filled: 0, sampled: 0 }, true));
  }
  // mapped first, then the ones with a role hint, system fields before custom ones, then by name
  rows.sort((a, b) => Number(b.mapped !== null) - Number(a.mapped !== null) || Number(b.role !== null) - Number(a.role !== null) || Number(a.custom) - Number(b.custom) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { refreshedAt: input.refreshedAt, error: input.error, sampled: input.sampled, rows, mappedCount: input.mappings.length, stale: input.refreshedAt !== null && (input.now ?? Date.now()) - Date.parse(input.refreshedAt) > STALE_DAYS * 86400000 };
}
