import { compareQuarters, quarterOfDate } from "./quarters";
import { UNSET, stackCounts, type ReportCtx, type ReportRow, type Stacked } from "./reports";

/**
 * OKRs report (Reports tab): how the initiatives divide over Objectives, grouped by Business Line, how that moves from quarter to quarter,
 * and, for the quarter we are in, how far each Objective is along the phases. Pure functions over the rows the grid already holds.
 * Objective and Business Line are free text and independent of each other (decision 2026-11-17-objective-and-business-line), so an
 * Objective can appear under several Business Lines; an initiative with neither is counted under "Not set", never dropped.
 */
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Distinct non-empty values in first-seen order, most frequent first. */
function distinct(values: string[]): string[] {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en")).map(([v]) => v);
}

export type ObjectiveLine = {
  /** The objective as written, or UNSET. */
  key: string;
  count: number;
  focusAreas: string[];
  owners: string[];
  valueTypes: string[];
};
export type BusinessLineGroup = { key: string; total: number; objectives: ObjectiveLine[] };

const unsetLast = (a: string, b: string) => (a === UNSET || b === UNSET ? (a === b ? 0 : a === UNSET ? 1 : -1) : 0);

/** Business Lines (largest first, "Not set" last), each with its Objectives (largest first, "Not set" last) and their item counts. */
export function okrByBusinessLine(rows: readonly ReportRow[]): BusinessLineGroup[] {
  const lines = new Map<string, Map<string, ReportRow[]>>();
  for (const r of rows) {
    const bl = text(r.business_line) || UNSET;
    const ob = text(r.okr_objective) || UNSET;
    const objectives = lines.get(bl) ?? lines.set(bl, new Map()).get(bl)!;
    (objectives.get(ob) ?? objectives.set(ob, []).get(ob)!).push(r);
  }
  return [...lines].map(([key, objectives]): BusinessLineGroup => {
    const list = [...objectives].map(([ob, items]): ObjectiveLine => ({
      key: ob, count: items.length,
      focusAreas: distinct(items.map((i) => text(i.focus_area))), owners: distinct(items.map((i) => text(i.sponsor))), valueTypes: distinct(items.map((i) => text(i.value_type))),
    })).sort((a, b) => unsetLast(a.key, b.key) || b.count - a.count || a.key.localeCompare(b.key, "en"));
    return { key, total: list.reduce((n, o) => n + o.count, 0), objectives: list };
  }).sort((a, b) => unsetLast(a.key, b.key) || b.total - a.total || a.key.localeCompare(b.key, "en"));
}

/** The calendar quarter of a day, in the form of the Planned Quarter field ("Q4 2026"). */
export const currentQuarter = (today: Date): string => quarterOfDate(today.toISOString().slice(0, 10))!;

/** Initiatives per Objective and Planned Quarter: quarters in time order (earliest first, "Unscheduled" last), Objectives largest first. */
export function objectiveByQuarter(rows: readonly ReportRow[], ctx: ReportCtx = {}): Stacked {
  const s = stackCounts(rows, "objective", "quarter", ctx);
  return { rows: s.rows, columns: [...s.columns].sort((a, b) => (a === UNSET || b === UNSET ? (a === b ? 0 : a === UNSET ? 1 : -1) : compareQuarters(a, b))) };
}

/** The initiatives planned for a quarter. */
export const inQuarter = (rows: readonly ReportRow[], quarter: string): ReportRow[] => rows.filter((r) => text(r.g2m_quarter) === quarter);
