import { PHASES, matchesFilters, type Filter } from "@pv/domain";

/** The phone list of initiatives (docs/29-MOBILE.md section 4.2): quick-filter chips, search, sort and grouping. Pure, so it can be tested. */
export type Chip = { id: string; label: string; filters: Filter[] };
export type PhoneRow = Record<string, unknown> & { id: string; item_code: string; initiative_name: string; stack_rank: number; home_project: string };

export const FIXED_CHIPS: Chip[] = [
  { id: "mine", label: "Mine", filters: [{ field: "product_manager", op: "is", value: "me" }] },
  { id: "new-week", label: "New this week", filters: [{ field: "created_at", op: "this_week" }] },
  { id: "attention", label: "Needs attention", filters: [{ field: "health", op: "any_of", values: ["At Risk", "Delayed", "Blocked"] }] },
  { id: "waiting", label: "Waiting for a decision", filters: [{ field: "gate_status", op: "any_of", values: ["In review", "Waiting for Approver"] }] },
];
/** One chip per phase except Completed (finished work is reached through search). */
export const PHASE_CHIPS: Chip[] = PHASES.filter((p) => p !== "Completed").map((p) => ({ id: `phase-${p}`, label: p, filters: [{ field: "initiative_phase", op: "is", value: p }] }));
export const ALL_CHIPS: Chip[] = [...FIXED_CHIPS, ...PHASE_CHIPS];

export type Sort = "rank" | "newest";
export type Group = "phase" | "project" | "quarter" | "none";
export const SORT_LABEL: Record<Sort, string> = { rank: "Rank", newest: "Newest" };
export const GROUP_LABEL: Record<Group, string> = { phase: "By phase", project: "By project", quarter: "By quarter", none: "Flat list" };

/** Filters of the chosen chips. Chips of the same kind (phases) widen the list (OR); different kinds narrow it (AND). */
export function chipFilters(selected: string[]): { phases: string[]; filters: Filter[] } {
  const phases: string[] = [];
  const filters: Filter[] = [];
  for (const id of selected) {
    const chip = ALL_CHIPS.find((c) => c.id === id);
    if (!chip) continue;
    if (id.startsWith("phase-")) phases.push(id.slice(6));
    else filters.push(...chip.filters);
  }
  return { phases, filters };
}

/** Every word must be found in the code, name, project, owner or tags. */
export function matchesPhoneSearch(row: PhoneRow, query: string, ctx: { project: (id: string) => string; person: (id: string) => string }): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const tags = Array.isArray(row.tags) ? row.tags.join(" ") : String(row.tags ?? "");
  const hay = `${row.item_code} ${row.initiative_name} ${ctx.project(row.home_project)} ${ctx.person(String(row.product_manager ?? ""))} ${tags}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterPhoneRows(rows: PhoneRow[], o: { query: string; chips: string[]; me: string | null; today: Date; project: (id: string) => string; person: (id: string) => string }): PhoneRow[] {
  const { phases, filters } = chipFilters(o.chips);
  const all: Filter[] = phases.length > 0 ? [...filters, { field: "initiative_phase", op: "any_of", values: phases }] : filters;
  return rows.filter((r) => matchesPhoneSearch(r, o.query, o) && matchesFilters(r, all, { me: o.me, today: o.today }));
}

const time = (r: PhoneRow) => Date.parse(String(r.created_at ?? "")) || 0;
export function sortPhoneRows(rows: PhoneRow[], sort: Sort): PhoneRow[] {
  return [...rows].sort(sort === "newest" ? (a, b) => time(b) - time(a) || a.stack_rank - b.stack_rank : (a, b) => a.stack_rank - b.stack_rank);
}

export type PhoneGroup = { key: string; label: string; rows: PhoneRow[] };
export function groupPhoneRows(rows: PhoneRow[], group: Group, projectName: (id: string) => string): PhoneGroup[] {
  if (group === "none") return [{ key: "all", label: "All", rows }];
  const labelOf = (r: PhoneRow) => group === "phase" ? String(r.initiative_phase ?? "") : group === "quarter" ? String(r.g2m_quarter ?? "") : projectName(r.home_project);
  const map = new Map<string, PhoneRow[]>();
  for (const r of rows) {
    const l = labelOf(r) || (group === "quarter" ? "No quarter" : group === "phase" ? "No phase" : "No project");
    map.set(l, [...(map.get(l) ?? []), r]);
  }
  const order = group === "phase" ? [...PHASES] : [];
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (group === "phase") return (order.indexOf(a as never) + 99) % 99 - (order.indexOf(b as never) + 99) % 99;
      if (a.startsWith("No ")) return 1;
      if (b.startsWith("No ")) return -1;
      return a.localeCompare(b);
    })
    .map(([label, rs]) => ({ key: label, label, rows: rs }));
}
