import type { RowDirection, TableRow } from "./links";

// Search, filter and sort of the tracker field table (decision 2026-11-11-tracker-field-table). Pure, so the rules are tested without a browser.

export type SortKey = "name" | "id" | "type" | "kind" | "filled" | "linked" | "direction";
export type Query = { text: string; type: string; kind: "all" | "system" | "custom"; direction: "all" | "used" | RowDirection; sort: SortKey | null; desc: boolean };
export const EMPTY_QUERY: Query = { text: "", type: "all", kind: "all", direction: "all", sort: null, desc: false };

const DIRECTION_ORDER: Record<RowDirection, number> = { two_way: 0, to_tracker: 1, from_tracker: 2, none: 3 };

/** The share of sampled issues with a value; null when the tracker was not sampled (sorted last whatever the direction). */
const fillRate = (r: TableRow) => (r.filled === null || r.sampled === null || r.sampled === 0 ? null : r.filled / r.sampled);

export function matches(r: TableRow, q: Query): boolean {
  if (q.type !== "all" && r.typeLabel !== q.type) return false;
  if (q.kind !== "all" && r.custom !== (q.kind === "custom")) return false;
  if (q.direction === "used" ? r.direction === "none" : q.direction !== "all" && r.direction !== q.direction) return false;
  const t = q.text.trim().toLowerCase();
  if (!t) return true;
  return [r.name, r.id, r.typeLabel, ...r.options, ...r.links.map((l) => l.label)].some((s) => s.toLowerCase().includes(t));
}

function compare(a: TableRow, b: TableRow, key: SortKey): number {
  switch (key) {
    case "name": return a.name.localeCompare(b.name);
    case "id": return a.id.localeCompare(b.id, undefined, { numeric: true });
    case "type": return a.typeLabel.localeCompare(b.typeLabel);
    case "kind": return Number(a.custom) - Number(b.custom);
    case "direction": return DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction];
    case "linked": return (a.links[0]?.label ?? "").localeCompare(b.links[0]?.label ?? "");
    case "filled": return (fillRate(a) ?? 0) - (fillRate(b) ?? 0);
  }
}

/** Filtered and sorted copy. The sort is stable and ties keep the tracker's own order; empty values (no link, not sampled) go last in both directions. */
export function applyQuery(rows: readonly TableRow[], q: Query): TableRow[] {
  const kept = rows.filter((r) => matches(r, q));
  const key = q.sort;
  if (!key) return kept;
  const empty = (r: TableRow) => (key === "filled" ? fillRate(r) === null : key === "linked" ? r.links.length === 0 : false);
  return kept
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const ex = empty(x.r), ey = empty(y.r);
      if (ex !== ey) return ex ? 1 : -1;
      const c = compare(x.r, y.r, key);
      return c !== 0 ? (q.desc ? -c : c) : x.i - y.i;
    })
    .map((x) => x.r);
}

/** Clicking a header: first ascending, then descending, then back to the tracker's order. */
export function nextSort(q: Query, key: SortKey): Query {
  if (q.sort !== key) return { ...q, sort: key, desc: false };
  if (!q.desc) return { ...q, desc: true };
  return { ...q, sort: null, desc: false };
}

export const isFiltered = (q: Query) => q.text !== "" || q.type !== "all" || q.kind !== "all" || q.direction !== "all";
