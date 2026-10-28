import { FIELD_BY_KEY } from "./registry";

/**
 * Reports tab (issue #233): filters, click-to-filter drill-down and the counts behind the charts. Pure functions over the rows the
 * grid already holds, so a count here is the count the Grid tab gives for the same filters.
 */
export const REPORT_DIMS = ["product_manager", "initiative_phase", "focus_area", "team", "quarter", "effort", "group", "initiative_status", "health"] as const;
export type ReportDim = (typeof REPORT_DIMS)[number];
/** The dimensions of the filter bar (status and health are reached by clicking the charts). */
export const BAR_DIMS: readonly ReportDim[] = ["product_manager", "initiative_phase", "focus_area", "team", "quarter", "effort", "group"];

/** The value of "nothing set" in a filter, a drill-down pill and a chart (labelled in words: Unscheduled, Not set, ...). */
export const UNSET = "__none";

/** The row field behind each dimension (team has its own splitting). */
export const DIM_FIELD: Record<ReportDim, string> = {
  product_manager: "product_manager", initiative_phase: "initiative_phase", focus_area: "focus_area", team: "contributing_teams", quarter: "g2m_quarter",
  effort: "effort", group: "theme", initiative_status: "initiative_status", health: "health",
};
export const DIM_LABEL: Record<ReportDim, string> = {
  product_manager: "Product Manager", initiative_phase: "Initiative Phase", focus_area: "Focus Area", team: "Team", quarter: "Planned Quarter", effort: "Effort",
  group: "Initiative Group", initiative_status: "Initiative Status", health: "Health",
};
export const unsetLabel = (dim: ReportDim) => (dim === "quarter" ? "Unscheduled" : dim === "product_manager" ? "No Product Manager" : dim === "team" ? "No team" : "Not set");

export type ReportRow = { id: string; archived?: unknown; ai_draft?: unknown } & Record<string, unknown>;
export type ReportCtx = { /** Known team names (a team name may contain a comma-free list separator only). */ teamNames?: readonly string[] };

export type Drill = { dim: ReportDim; value: string };
export type ReportState = {
  filters: Partial<Record<ReportDim, string[]>>;
  drill: Drill[];
  /** Include archived initiatives (off by default). */
  archived: boolean;
  /** Include unreviewed AI drafts (on by default). */
  aiDrafts: boolean;
};
export const emptyReport = (): ReportState => ({ filters: {}, drill: [], archived: false, aiDrafts: true });

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The keys a row has on a dimension: one, except Team (one per team); `[UNSET]` when it has none. */
export function valuesOf(row: ReportRow, dim: ReportDim, ctx: ReportCtx = {}): string[] {
  const raw = text(row[DIM_FIELD[dim]]);
  if (dim === "team") {
    const parts = raw.split(/,\s*/).filter(Boolean);
    const known = ctx.teamNames ? parts.filter((p) => ctx.teamNames!.includes(p)) : parts;
    return known.length > 0 ? [...new Set(known)] : [UNSET];
  }
  return [raw || UNSET];
}

/** Does the row pass the bar, the drill-down and the two toggles? Values of one dimension are OR, dimensions are AND. */
export function matchesReport(row: ReportRow, state: ReportState, ctx: ReportCtx = {}): boolean {
  if (!state.archived && row.archived === true) return false;
  if (!state.aiDrafts && row.ai_draft === true) return false;
  for (const dim of REPORT_DIMS) {
    const bar = state.filters[dim];
    const clicked = state.drill.filter((d) => d.dim === dim).map((d) => d.value);
    if (bar && bar.length > 0 || clicked.length > 0) {
      const have = valuesOf(row, dim, ctx);
      if (bar && bar.length > 0 && !have.some((v) => bar.includes(v))) return false;
      if (clicked.length > 0 && !have.some((v) => clicked.includes(v))) return false;
    }
  }
  return true;
}

export const drillOn = (state: ReportState, dim: ReportDim, value: string) => state.drill.some((d) => d.dim === dim && d.value === value);
/** Clicking a chart element adds its pill; clicking it again removes it. */
export function toggleDrill(state: ReportState, dim: ReportDim, value: string): ReportState {
  return { ...state, drill: drillOn(state, dim, value) ? state.drill.filter((d) => !(d.dim === dim && d.value === value)) : [...state.drill, { dim, value }] };
}

// ---- counts behind the charts
const allowed = (key: string): string[] => FIELD_BY_KEY[key]?.allowed ?? [];
/** Canonical order of a dimension's values (the dictionary's order); other dimensions sort by name with "not set" last. */
const ORDER: Partial<Record<ReportDim, string[]>> = {
  get initiative_phase() { return allowed("initiative_phase"); }, get initiative_status() { return allowed("initiative_status"); },
  get health() { return allowed("health"); }, get effort() { return allowed("effort"); },
};
export function compareValues(dim: ReportDim, a: string, b: string): number {
  if (a === UNSET || b === UNSET) return a === b ? 0 : a === UNSET ? 1 : -1;
  const order = ORDER[dim];
  if (order) { const ia = order.indexOf(a), ib = order.indexOf(b); if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); }
  return a.localeCompare(b, "en");
}

export type Stack = { key: string; total: number; cells: Record<string, number> };
export type Stacked = { rows: Stack[]; columns: string[] };

/** Counts of `col` values for each `row` value, largest row first. An item with several values on a dimension (teams) counts once per value. */
export function stackCounts(rows: readonly ReportRow[], rowDim: ReportDim, colDim: ReportDim, ctx: ReportCtx = {}): Stacked {
  const by = new Map<string, Stack>();
  const cols = new Set<string>();
  for (const r of rows) {
    const cs = valuesOf(r, colDim, ctx);
    for (const k of valuesOf(r, rowDim, ctx)) {
      const s = by.get(k) ?? { key: k, total: 0, cells: {} };
      for (const c of cs) { s.cells[c] = (s.cells[c] ?? 0) + 1; s.total += 1; cols.add(c); }
      by.set(k, s);
    }
  }
  return {
    rows: [...by.values()].sort((a, b) => b.total - a.total || compareValues(rowDim, a.key, b.key)),
    columns: [...cols].sort((a, b) => compareValues(colDim, a, b)),
  };
}

// ---- the address (so a view can be shared)
const FILTER_PREFIX = "f.";
const isDim = (v: string): v is ReportDim => (REPORT_DIMS as readonly string[]).includes(v);

export function serializeReport(state: ReportState): URLSearchParams {
  const p = new URLSearchParams();
  for (const dim of REPORT_DIMS) for (const v of state.filters[dim] ?? []) p.append(FILTER_PREFIX + dim, v);
  for (const d of state.drill) p.append("d", `${d.dim}:${d.value}`);
  if (state.archived) p.set("arch", "1");
  if (!state.aiDrafts) p.set("draft", "0");
  return p;
}

export function parseReport(p: URLSearchParams): ReportState {
  const s = emptyReport();
  for (const dim of REPORT_DIMS) { const vs = p.getAll(FILTER_PREFIX + dim).filter(Boolean); if (vs.length > 0) s.filters[dim] = vs; }
  for (const raw of p.getAll("d")) {
    const i = raw.indexOf(":");
    const dim = raw.slice(0, i), value = raw.slice(i + 1);
    if (i > 0 && value && isDim(dim) && !drillOn(s, dim, value)) s.drill.push({ dim, value });
  }
  s.archived = p.get("arch") === "1";
  s.aiDrafts = p.get("draft") !== "0";
  return s;
}

/**
 * Columns of the Reports grid and its CSV. A fixed list with no commercial field (value, confidence, customers, decision, key results):
 * the Reports tab never shows them to any role (issue #233 FR-5.1).
 */
export const REPORT_GRID_COLUMNS: readonly string[] = [
  "item_code", "initiative_name", "home_project", "product_manager", "initiative_phase", "initiative_status", "health", "contributing_teams",
  "theme", "focus_area", "effort", "g2m_quarter", "planned_start", "g2m_date_est",
];
