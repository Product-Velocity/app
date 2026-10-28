import { fromDay, toDay } from "./gantt";
import { UNSET, valuesOf, type ReportCtx, type ReportDim, type ReportRow } from "./reports";

/**
 * Time to Market and the lifecycle timeline (issue #233, FR-3.4 and FR-3.6). Time to Market (days) is G2M Date (actual) minus the earlier
 * of Start Discovery and Start Date (section 5.2); rows that cannot be counted are left out and counted as excluded.
 */
const day = (v: unknown) => (typeof v === "string" ? toDay(v) : NaN);

/** Initiative Phase and the date field that says when it started, in lifecycle order. */
export const PHASE_STARTS: readonly { phase: string; field: string }[] = [
  { phase: "Discover", field: "start_discovery" }, { phase: "Define", field: "start_definition" }, { phase: "Build", field: "start_building" },
  { phase: "Beta-test", field: "start_beta" }, { phase: "Experiment", field: "start_experiment" }, { phase: "Roll-out", field: "start_rollout" },
];

/** Days from the start of work to G2M Date (actual); null when either date is missing or the end is before the start. */
export function timeToMarket(row: ReportRow): { days: number; start: number; end: number } | null {
  const starts = [day(row.start_discovery), day(row.start_date)].filter((d) => !Number.isNaN(d));
  const end = day(row.g2m_date_actual);
  if (starts.length === 0 || Number.isNaN(end)) return null;
  const start = Math.min(...starts);
  return end >= start ? { days: end - start, start, end } : null;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length === 0 ? null : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const average = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export type TtmPoint = { id: string; days: number; end: number };
export type TtmSummary = { count: number; excluded: number; median: number | null; average: number | null; points: TtmPoint[] };

export function ttmSummary(rows: readonly ReportRow[]): TtmSummary {
  const points: TtmPoint[] = [];
  for (const r of rows) { const t = timeToMarket(r); if (t) points.push({ id: r.id, days: t.days, end: t.end }); }
  const days = points.map((p) => p.days);
  return { count: points.length, excluded: rows.length - points.length, median: median(days), average: average(days), points };
}

export type TtmGroup = { key: string; count: number; median: number; average: number };
/** Median and average days per value of a dimension (Team, Effort, ...), an initiative with several teams counted once per team. Sorted by name, "not set" last. */
export function ttmBy(rows: readonly ReportRow[], dim: ReportDim, ctx: ReportCtx = {}): TtmGroup[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const t = timeToMarket(r);
    if (!t) continue;
    for (const k of valuesOf(r, dim, ctx)) by.set(k, [...(by.get(k) ?? []), t.days]);
  }
  return [...by].map(([key, ds]) => ({ key, count: ds.length, median: median(ds)!, average: average(ds)! })).sort((a, b) => (a.key === UNSET ? 1 : b.key === UNSET ? -1 : a.key.localeCompare(b.key, "en")));
}

/** Days spent in each phase: from its start date to the next start date, the last to G2M Date (actual). Only initiatives with a G2M Date (actual) count. */
export function phaseDurations(rows: readonly ReportRow[]): { phase: string; count: number; average: number; median: number }[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const end = day(r.g2m_date_actual);
    if (Number.isNaN(end)) continue;
    const starts = PHASE_STARTS.map((p) => ({ phase: p.phase, d: day(r[p.field]) })).filter((p) => !Number.isNaN(p.d)).sort((a, b) => a.d - b.d);
    starts.forEach((p, i) => {
      const until = i + 1 < starts.length ? starts[i + 1]!.d : end;
      if (until >= p.d) by.set(p.phase, [...(by.get(p.phase) ?? []), until - p.d]);
    });
  }
  return PHASE_STARTS.filter((p) => by.has(p.phase)).map((p) => { const ds = by.get(p.phase)!; return { phase: p.phase, count: ds.length, average: average(ds)!, median: median(ds)! }; });
}

export type Segment = { phase: string; start: string; end: string };
/**
 * The bars of one initiative on the timeline: a segment per phase start date, each ending where the next begins, the last at G2M Date
 * (actual), else G2M Date (est), else today. With no phase dates: Planned Start to G2M Date (est) in the current phase. Null when nothing can be drawn.
 */
export function lifecycleSegments(row: ReportRow, today: Date): Segment[] | null {
  const todayDay = Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000);
  const phase = typeof row.initiative_phase === "string" && row.initiative_phase ? row.initiative_phase : "Not set";
  const starts = PHASE_STARTS.map((p) => ({ phase: p.phase, d: day(row[p.field]) })).filter((p) => !Number.isNaN(p.d)).sort((a, b) => a.d - b.d);
  if (starts.length === 0) {
    const s = day(row.planned_start), e = day(row.g2m_date_est);
    return !Number.isNaN(s) && !Number.isNaN(e) && e >= s ? [{ phase, start: fromDay(s), end: fromDay(e) }] : null;
  }
  const actual = day(row.g2m_date_actual), est = day(row.g2m_date_est);
  const last = !Number.isNaN(actual) ? actual : !Number.isNaN(est) ? est : todayDay;
  return starts.map((p, i) => ({ phase: p.phase, start: fromDay(p.d), end: fromDay(Math.max(p.d, i + 1 < starts.length ? starts[i + 1]!.d : last)) }));
}
