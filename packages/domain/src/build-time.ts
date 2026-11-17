import { fromDay, toDay } from "./gantt";
import { UNSET, valuesOf, type ReportCtx, type ReportDim, type ReportRow } from "./reports";

/**
 * Build time (issue #480, Ashu 2026-11-17: "use the build dates and statuses, also in the reports on build time/weeks"). How long the build took, in weeks, from Start Building
 * to the tracker's Build Completed (a GitHub ticket closed as completed, else a Jira issue resolved while done), or to the start of the next phase when the tracker has no
 * completion. The number is the computed field Actual Build (weeks) (view `items_computed`), so the grid and this report always agree. Only initiatives with a build time are
 * counted; those that started building and have none are counted apart ("still building"), never as zero.
 */
const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length === 0 ? null : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const average = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export type BuildPoint = { id: string; weeks: number; days: number; start: string; end: string | null };
/** The build time of an initiative, or null when it has none (no Start Building, or no end yet). */
export function buildTimeOf(row: ReportRow): BuildPoint | null {
  const weeks = num(row.actual_build_weeks), days = num(row.time_building_days);
  if (weeks === null || weeks < 0 || days === null || days < 0) return null;
  const start = typeof row.start_building === "string" && row.start_building ? row.start_building.slice(0, 10) : null;
  if (!start) return null;
  const s = toDay(start);
  return { id: row.id, weeks, days, start, end: Number.isNaN(s) ? null : fromDay(s + days) };
}

export type BuildTimeSummary = {
  /** Initiatives with a build time. */
  count: number;
  /** Initiatives that started building and have no build time yet (still building, or the tracker has not completed). */
  stillBuilding: number;
  median: number | null;
  average: number | null;
  points: BuildPoint[];
};
export function buildTimeSummary(rows: readonly ReportRow[]): BuildTimeSummary {
  const points: BuildPoint[] = [];
  let still = 0;
  for (const r of rows) {
    const p = buildTimeOf(r);
    if (p) points.push(p);
    else if (typeof r.start_building === "string" && r.start_building) still++;
  }
  const weeks = points.map((p) => p.weeks);
  return { count: points.length, stillBuilding: still, median: median(weeks), average: average(weeks), points };
}

export type BuildGroup = { key: string; count: number; median: number; average: number };
/** Median and average build weeks per value of a dimension (Team, Effort, ...), an initiative with several teams counted once per team. Sorted by name, "not set" last. */
export function buildTimeBy(rows: readonly ReportRow[], dim: ReportDim, ctx: ReportCtx = {}): BuildGroup[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const p = buildTimeOf(r);
    if (!p) continue;
    for (const k of valuesOf(r, dim, ctx)) by.set(k, [...(by.get(k) ?? []), p.weeks]);
  }
  return [...by].map(([key, ws]) => ({ key, count: ws.length, median: median(ws)!, average: average(ws)! })).sort((a, b) => (a.key === UNSET ? 1 : b.key === UNSET ? -1 : a.key.localeCompare(b.key, "en")));
}

export type EstimateSummary = { count: number; median: number | null; over: number; within: number };
/** Build against the high estimate: of the initiatives with both, how many took longer than the estimate, and the median share of it (100 = exactly the estimate). */
export function buildVsEstimate(rows: readonly ReportRow[]): EstimateSummary {
  const pct: number[] = [];
  for (const r of rows) { const v = num(r.build_vs_estimate_high_pct); if (v !== null && v >= 0 && buildTimeOf(r)) pct.push(v); }
  return { count: pct.length, median: median(pct), over: pct.filter((v) => v > 100).length, within: pct.filter((v) => v <= 100).length };
}
