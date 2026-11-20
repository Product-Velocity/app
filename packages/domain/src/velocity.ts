import { fromDay, toDay } from "./gantt";
import { buildTimeOf } from "./build-time";
import type { GateId, GateOutcome, GateRequest } from "./gates";
import { UNSET, valuesOf, type ReportCtx, type ReportDim, type ReportRow } from "./reports";

/**
 * Velocity report (issue #545, `docs/decisions/2026-11-19-velocity-report.md`): how long initiatives take from Start Discovery to Start Roll-Out,
 * to each gate, and in Build; where the time goes; how long a gate takes to decide. Pure functions over the rows the Reports tab already holds and
 * the gate requests, so every number can be traced to dates on the Grid. Everything is in days (day numbers, see `gantt.ts`); the screen turns
 * them into weeks. Team level only: nothing here is about a person (rule 8). An initiative that has not reached the end of a measure is never
 * counted as zero; it is counted apart.
 */

// ---- the measures
/**
 * A measure is a set of phases (stages) of the journey. The time of an initiative is the sum of the phases of the set that have dates (a start and an end that has passed),
 * so an initiative with only Build dates still counts, and one with Discover and Build counts both. Nothing is left out because another date is missing.
 */
export const VELOCITY_MEASURES = [
  { id: "total", label: "Total", description: "Every phase with dates, from Discovery to Start Roll-Out, added up." },
  { id: "gate_a", label: "To Gate A", description: "The phases up to the Gate A decision that have dates, added up.", },
  { id: "gate_b", label: "To Gate B", description: "The phases up to the Gate B decision that have dates, added up.", stretch: "Define and waiting for Gate B." },
  { id: "gate_c", label: "To Gate C", description: "The phases up to the Gate C decision that have dates, added up.", stretch: "From the Gate B decision to the Gate C decision." },
  { id: "discover", label: "Discover", description: "Discover: Start Discovery to the Gate A request (or Start Definition)." },
  { id: "define", label: "Define", description: "Define: Start Definition to the Gate B request (or Start Building)." },
  { id: "build", label: "Build", description: "Build: Start Building to the end of the build (the same as Actual Build)." },
  { id: "test", label: "Test", description: "Test: Start Test to Start Experiment (or the next date there is)." },
  { id: "experiment", label: "Experiment", description: "Experiment: Start Experiment to the Gate C request (or the next date there is)." },
] as const;
export type VelocityMeasureId = (typeof VELOCITY_MEASURES)[number]["id"];
export const DEFAULT_MEASURE: VelocityMeasureId = "total";
export const parseMeasure = (v: string | null | undefined): VelocityMeasureId => VELOCITY_MEASURES.find((m) => m.id === v)?.id ?? DEFAULT_MEASURE;
/** Only Gate B and Gate C can start at the previous gate. */
export const hasStretch = (m: VelocityMeasureId) => m === "gate_b" || m === "gate_c";

/** What the report can be broken down by, in the order of the buttons. */
export const VELOCITY_DIMS: readonly ReportDim[] = ["team", "key_result", "objective", "business_line", "group", "focus_area"];
export const parseVelocityDim = (v: string | null | undefined): ReportDim => VELOCITY_DIMS.find((d) => d === v) ?? "team";

export type VelocitySettings = { measure: VelocityMeasureId; /** Count from the previous gate instead of Start Discovery (Gate B and C only). */ stretch: boolean };

// ---- dates and the journey of one initiative
const day = (v: unknown): number => (typeof v === "string" && v ? toDay(v.slice(0, 10)) : NaN);
/** Today as a day number. */
export const dayOfDate = (d: Date): number => Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
const quarterOfDay = (d: number): string => { const iso = fromDay(d); return `Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1} ${iso.slice(0, 4)}`; };
const quarterKey = (q: string): number => { const [a, b] = q.split(" "); return Number(b) * 10 + Number(a!.slice(1)); };

export const MILESTONES = ["start", "aReq", "a", "bReq", "b", "build", "test", "exp", "cReq", "c", "roll"] as const;
export type Milestone = (typeof MILESTONES)[number];

export type Journey = {
  id: string;
  /** The dates that exist, as day numbers. */
  raw: Partial<Record<Milestone, number>>;
  /** Every boundary of the journey: a missing one (a skipped phase, a gate without a request) takes the next one that exists, so the stage before it runs on and the skipped one is zero days. Never earlier than the one before. Null after the last date that exists. */
  filled: Record<Milestone, number | null>;
};

const PASS: ReadonlySet<GateOutcome | null> = new Set<GateOutcome | null>(["go", "go_with_conditions"]);

/**
 * The milestones of an initiative: Start Discovery (the earlier of it and Start Date, as Time to Market has it), per gate the request and the decision that passed it
 * (the latest Go or Go with conditions; without one, the date the phase started), and the phase starts Start Building, Start Test, Start Experiment and Start Roll-Out.
 */
export function journeyOf(row: ReportRow, requests: readonly GateRequest[] = []): Journey {
  const raw: Partial<Record<Milestone, number>> = {};
  const set = (k: Milestone, v: number) => { if (!Number.isNaN(v)) raw[k] = v; };
  const starts = [day(row.start_discovery), day(row.start_date)].filter((d) => !Number.isNaN(d));
  if (starts.length > 0) raw.start = Math.min(...starts);
  const gates: [GateId, Milestone, Milestone][] = [["A", "aReq", "a"], ["B", "bReq", "b"], ["C", "cReq", "c"]];
  for (const [gate, req, dec] of gates) {
    const passed = requests
      .filter((r) => r.item_id === row.id && r.gate === gate && r.kind === "decision" && r.decided_at && PASS.has(r.outcome))
      .sort((a, b) => b.decided_at!.localeCompare(a.decided_at!))[0];
    if (passed) { set(req, day(passed.requested_at)); set(dec, day(passed.decided_at)); }
  }
  if (raw.a === undefined) set("a", day(row.start_definition));
  if (raw.b === undefined) set("b", day(row.start_building));
  if (raw.c === undefined) set("c", day(row.start_rollout));
  set("build", day(row.start_building)); set("test", day(row.start_beta)); set("exp", day(row.start_experiment)); set("roll", day(row.start_rollout));

  const filled = {} as Record<Milestone, number | null>;
  let next: number | null = null;
  for (let i = MILESTONES.length - 1; i >= 0; i--) { const v = raw[MILESTONES[i]!]; if (v !== undefined) next = v; filled[MILESTONES[i]!] = v ?? next; }
  let prev: number | null = null;
  for (const m of MILESTONES) { const v = filled[m]; if (v !== null && prev !== null && v < prev) filled[m] = prev; prev = filled[m] ?? prev; }
  return { id: row.id, raw, filled };
}

// ---- stages: the whole journey in ten steps, work or waiting
export type StageKind = "work" | "gate" | "queue";
export const STAGES = [
  { id: "discover", label: "Discover", kind: "work", from: "start", to: "aReq" },
  { id: "wait_a", label: "Waiting for Gate A", kind: "gate", from: "aReq", to: "a" },
  { id: "define", label: "Define", kind: "work", from: "a", to: "bReq" },
  { id: "wait_b", label: "Waiting for Gate B", kind: "gate", from: "bReq", to: "b" },
  { id: "queue_build", label: "Waiting to start build", kind: "queue", from: "b", to: "build" },
  { id: "build", label: "Build", kind: "work", from: "build", to: "test" },
  { id: "test", label: "Test", kind: "work", from: "test", to: "exp" },
  { id: "experiment", label: "Experiment", kind: "work", from: "exp", to: "cReq" },
  { id: "wait_c", label: "Waiting for Gate C", kind: "gate", from: "cReq", to: "c" },
  { id: "queue_roll", label: "Waiting to start roll-out", kind: "queue", from: "c", to: "roll" },
] as const satisfies readonly { id: string; label: string; kind: StageKind; from: Milestone; to: Milestone }[];
export type StageId = (typeof STAGES)[number]["id"];

// ---- the phases of the journey that have dates
/** The span of each phase that has a start and an end that has passed. A phase whose dates are missing is left out, never counted as zero. */
export type Spans = Partial<Record<StageId, { start: number; end: number }>>;

/**
 * The finished phases of one initiative, from the dates that exist. A work phase (Discover, Define, Build, Test, Experiment) runs from its own start to the next date
 * the initiative has (a request, a decision or the next phase start); Build is the tracker's Actual Build when there is one. A waiting phase (a gate wait, a queue)
 * needs both of its dates.
 */
export function stageSpans(row: ReportRow, j: Journey, today: number): Spans {
  const out: Spans = {};
  const tracker = buildTimeOf(row);
  for (const s of STAGES) {
    const start = j.raw[s.from];
    if (start === undefined) continue;
    let end: number | undefined;
    if (s.id === "build" && tracker) end = day(tracker.start) + tracker.days;
    else if (s.kind === "work") end = MILESTONES.slice(MILESTONES.indexOf(s.from) + 1).map((m) => j.raw[m]).find((d) => d !== undefined);
    else end = j.raw[s.to];
    // a wait or queue of zero days is two dates that are one and the same (no request, so the decision date is also the next start): nothing was measured
    if (end !== undefined && !Number.isNaN(end) && end >= start && end <= today && (s.kind === "work" || end > start)) out[s.id] = { start, end };
  }
  return out;
}

/** The phases each measure adds up, and the ones the stretch ("from the previous gate") adds up. */
const MEASURE_STAGES: Record<VelocityMeasureId, readonly StageId[]> = {
  total: STAGES.map((s) => s.id),
  gate_a: ["discover", "wait_a"],
  gate_b: ["discover", "wait_a", "define", "wait_b"],
  gate_c: ["discover", "wait_a", "define", "wait_b", "queue_build", "build", "test", "experiment", "wait_c"],
  discover: ["discover"], define: ["define"], build: ["build"], test: ["test"], experiment: ["experiment"],
};
const STRETCH_STAGES: Partial<Record<VelocityMeasureId, readonly StageId[]>> = {
  gate_b: ["define", "wait_b"],
  gate_c: ["queue_build", "build", "test", "experiment", "wait_c"],
};
/** The phases a measure adds up. */
export const measureStages = (s: VelocitySettings): readonly StageId[] => (s.stretch ? STRETCH_STAGES[s.measure] : undefined) ?? MEASURE_STAGES[s.measure];
/** The first date after which the measure counts as reached: any date at or after it means the initiative is past the measure. */
const MEASURE_END: Record<VelocityMeasureId, Milestone> = { total: "roll", gate_a: "a", gate_b: "b", gate_c: "c", discover: "aReq", define: "bReq", build: "test", test: "exp", experiment: "cReq" };

// ---- one row per initiative: the value of the measure
export type VelocityRow = {
  id: string;
  row: ReportRow;
  journey: Journey;
  /** The finished phases of this initiative with dates (all phases, not only those of the measure). */
  spans: Spans;
  /** The phases of the measure that have dates, in order. */
  known: StageId[];
  /** Where the measure starts (the first phase start of the measure that exists), else null. */
  start: number | null;
  /** The end of the last finished phase of the measure, else null. */
  end: number | null;
  /** The initiative is past the end of the measure (a date at or after it exists), so what is known is the whole of it. */
  complete: boolean;
  /** Days: the sum of the phases of the measure that have dates, or null when none has. Never zero for "not yet". */
  value: number | null;
};

export function velocityRows(rows: readonly ReportRow[], requests: readonly GateRequest[], settings: VelocitySettings, today: number): VelocityRow[] {
  const byItem = new Map<string, GateRequest[]>();
  for (const q of requests) (byItem.get(q.item_id) ?? byItem.set(q.item_id, []).get(q.item_id)!).push(q);
  const set = measureStages(settings);
  const endAt = MILESTONES.indexOf(MEASURE_END[settings.measure]);
  return rows.map((row) => {
    const journey = journeyOf(row, byItem.get(row.id) ?? []);
    const spans = stageSpans(row, journey, today);
    const known = set.filter((id) => spans[id] !== undefined);
    const starts = set.map((id) => journey.raw[STAGES.find((s) => s.id === id)!.from]).filter((d): d is number => d !== undefined && d <= today);
    const value = known.length === 0 ? null : known.reduce((x, id) => x + (spans[id]!.end - spans[id]!.start), 0);
    const complete = known.includes(set[set.length - 1]!) || MILESTONES.slice(endAt).some((m) => { const d = journey.raw[m]; return d !== undefined && d <= today; });
    return { id: row.id, row, journey, spans, known, start: starts.length ? Math.min(...starts) : null, end: known.length ? Math.max(...known.map((id) => spans[id]!.end)) : null, complete, value };
  });
}

// ---- numbers
export type Stats = { n: number; min: number; max: number; p10: number; p25: number; median: number; p75: number; p80: number; p90: number; average: number };
const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
/** The p-th share (0 to 1) of sorted values, interpolating between neighbours. */
export function percentile(s: readonly number[], p: number): number | null {
  if (s.length === 0) return null;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}
export function statsOf(values: readonly number[]): Stats | null {
  if (values.length === 0) return null;
  const s = sorted(values);
  const at = (p: number) => percentile(s, p)!;
  return { n: s.length, min: s[0]!, max: s[s.length - 1]!, p10: at(0.1), p25: at(0.25), median: at(0.5), p75: at(0.75), p80: at(0.8), p90: at(0.9), average: s.reduce((a, b) => a + b, 0) / s.length };
}

/** What the dates allow for the measure chosen: how many initiatives have a phase of it that has started, and how many have at least one phase with a start and an end. */
export type WindowCoverage = { initiatives: number; withStart: number; withBoth: number };
export function windowCoverage(vrows: readonly VelocityRow[]): WindowCoverage {
  return { initiatives: vrows.length, withStart: vrows.filter((v) => v.start !== null).length, withBoth: vrows.filter((v) => v.value !== null).length };
}

export type VelocitySummary = {
  /** Initiatives that reached the end of the measure. */
  counted: number;
  /** Started, not at the end yet: on the way, never counted as zero. */
  notThere: number;
  /** No start date, so nothing can be measured. */
  noStart: number;
  stats: Stats | null;
};
export function velocitySummary(vrows: readonly VelocityRow[]): VelocitySummary {
  const values = vrows.filter((v) => v.value !== null).map((v) => v.value!);
  const noStart = vrows.filter((v) => v.start === null).length;
  return { counted: values.length, notThere: vrows.length - values.length - noStart, noStart, stats: statsOf(values) };
}

// ---- the bell: bars and a smooth curve over them
export type Zone = 0 | 1 | 2 | 3 | 4;
/** Fastest 10%, faster than typical, typical (middle half), slower than typical, slowest 10%. */
export const ZONES = ["Fastest 10%", "Faster than typical", "Typical (middle half)", "Slower than typical", "Slowest 10%"] as const;
export type Bin = { from: number; to: number; count: number; zone: Zone };
const niceStep = (raw: number): number => { const m = Math.pow(10, Math.floor(Math.log10(raw))); for (const c of [1, 2, 2.5, 5, 10]) if (c * m >= raw) return c * m; return 10 * m; };

/** Bars of about twelve equal buckets on a round width, over `values` already in the unit to show (days divided by 7 for weeks). */
export function histogram(values: readonly number[]): { bins: Bin[]; width: number } | null {
  const st = statsOf(values);
  if (!st) return null;
  const width = niceStep(Math.max((st.max - st.min) / 12, 0.01));
  const from = Math.floor(st.min / width) * width;
  const count = Math.max(1, Math.ceil((st.max - from) / width + 1e-9));
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({ from: from + i * width, to: from + (i + 1) * width, count: 0, zone: 2 as Zone }));
  for (const v of values) bins[Math.min(count - 1, Math.floor((v - from) / width))]!.count += 1;
  for (const b of bins) { const c = (b.from + b.to) / 2; b.zone = c < st.p10 ? 0 : c < st.p25 ? 1 : c <= st.p75 ? 2 : c <= st.p90 ? 3 : 4; }
  return { bins, width };
}

/** The smooth curve over the bars (a Gaussian kernel, scaled to the height of the bars). */
export function bellCurve(values: readonly number[], from: number, to: number, width: number, points = 80): { x: number; y: number }[] {
  const n = values.length;
  if (n === 0 || to <= from) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  const h = Math.max(1.06 * sd * Math.pow(n, -0.2), (to - from) / 40);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const x = from + ((to - from) * i) / points;
    let d = 0;
    for (const v of values) d += Math.exp(-0.5 * ((x - v) / h) ** 2);
    out.push({ x, y: (d / (n * h * Math.sqrt(2 * Math.PI))) * n * width });
  }
  return out;
}

// ---- groups: by size, team, Key Result, Objective, ...
export const SIZES = ["XS", "S", "M", "L", "XL"] as const;
const sizeOf = (v: VelocityRow) => (typeof v.row.effort === "string" ? v.row.effort : "");

/** The median a row would have for its own T-shirt size (the median of that size when it has 3 or more, else the overall median). */
function expectedBySize(vrows: readonly VelocityRow[]): (v: VelocityRow) => number | null {
  const counted = vrows.filter((v) => v.value !== null);
  const overall = percentile(sorted(counted.map((v) => v.value!)), 0.5);
  const bySize = new Map<string, number>();
  for (const sz of SIZES) { const xs = counted.filter((v) => sizeOf(v) === sz).map((v) => v.value!); if (xs.length >= 3) bySize.set(sz, percentile(sorted(xs), 0.5)!); }
  return (v) => bySize.get(sizeOf(v)) ?? overall;
}

export type GroupStat = {
  key: string;
  n: number;
  stats: Stats;
  /** The values themselves (for the dots of a small group). */
  values: number[];
  /** The group's median against what its own mix of sizes predicts: 1.2 is 20% slower than expected. */
  adjusted: number | null;
};
/** Fewer values than this draw as dots instead of a box. */
export const MIN_FOR_BOX = 5;

/**
 * Per value of a dimension, the stats of the counted initiatives. An initiative with several teams counts once per team. `order`: slowest median
 * first (the default), or the dimension's own order (sizes XS to XL).
 */
export function groupStats(vrows: readonly VelocityRow[], dim: ReportDim, ctx: ReportCtx = {}, order: "slowest" | "sizes" = "slowest"): GroupStat[] {
  const expected = expectedBySize(vrows);
  const by = new Map<string, VelocityRow[]>();
  for (const v of vrows) { if (v.value === null) continue; for (const k of valuesOf(v.row, dim, ctx)) (by.get(k) ?? by.set(k, []).get(k)!).push(v); }
  const out: GroupStat[] = [];
  for (const [key, vs] of by) {
    const values = vs.map((v) => v.value!);
    const exp = percentile(sorted(vs.map((v) => expected(v)).filter((x): x is number => x !== null)), 0.5);
    const stats = statsOf(values)!;
    out.push({ key, n: values.length, stats, values: sorted(values), adjusted: exp ? stats.median / exp : null });
  }
  return out.sort((a, b) => (a.key === UNSET ? 1 : b.key === UNSET ? -1 : order === "sizes" ? SIZES.indexOf(a.key as never) - SIZES.indexOf(b.key as never) : b.stats.median - a.stats.median || a.key.localeCompare(b.key, "en")));
}
/** The T-shirt sizes in their own order; a size with no counted initiative is left out. */
export const sizeStats = (vrows: readonly VelocityRow[]): GroupStat[] => groupStats(vrows, "effort", {}, "sizes");

// ---- trend: the quarter in which each initiative reached the end of the measure
export type QuarterPoint = { quarter: string; n: number; p25: number; median: number; p75: number };
export function trendByQuarter(vrows: readonly VelocityRow[], minimum = 3): QuarterPoint[] {
  const by = new Map<string, number[]>();
  for (const v of vrows) if (v.value !== null && v.end !== null) { const q = quarterOfDay(v.end); (by.get(q) ?? by.set(q, []).get(q)!).push(v.value); }
  return [...by].filter(([, xs]) => xs.length >= minimum).sort((a, b) => quarterKey(a[0]) - quarterKey(b[0])).map(([quarter, xs]) => {
    const s = statsOf(xs)!;
    return { quarter, n: s.n, p25: s.p25, median: s.median, p75: s.p75 };
  });
}
/** The median of the latest two quarters against the ones before them, when both sides have at least 5 initiatives. */
export function recentChange(vrows: readonly VelocityRow[]): { recent: number; before: number; ratio: number } | null {
  const quarters = trendByQuarter(vrows);
  if (quarters.length < 3) return null;
  const last = new Set(quarters.slice(-2).map((q) => q.quarter));
  const a: number[] = [], b: number[] = [];
  for (const v of vrows) if (v.value !== null && v.end !== null) (last.has(quarterOfDay(v.end)) ? a : b).push(v.value);
  if (a.length < 5 || b.length < 5) return null;
  const recent = percentile(sorted(a), 0.5)!, before = percentile(sorted(b), 0.5)!;
  return { recent, before, ratio: recent / before };
}

// ---- where the time goes
/**
 * Days of each phase of the measure that has dates; a phase without dates is zero here (it is not part of this initiative's time), so the phases add up to the
 * value of the measure exactly.
 */
export function stageDays(v: VelocityRow): Record<StageId, number> {
  const out = {} as Record<StageId, number>;
  for (const s of STAGES) out[s.id] = v.known.includes(s.id) ? v.spans[s.id]!.end - v.spans[s.id]!.start : 0;
  return out;
}
export type StageAverage = { id: StageId; label: string; kind: StageKind; average: number };
/** The average days per stage over the counted initiatives, so the stages add up to the average of the measure. */
export function stageAverages(vrows: readonly VelocityRow[]): StageAverage[] {
  const counted = vrows.filter((v) => v.value !== null);
  const total = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
  for (const v of counted) { const d = stageDays(v); for (const s of STAGES) total[s.id] += d[s.id]; }
  return STAGES.map((s) => ({ id: s.id, label: s.label, kind: s.kind, average: counted.length === 0 ? 0 : total[s.id] / counted.length }));
}
/** The share of elapsed time for working (per phase), waiting for a gate decision and waiting in a queue. */
export function workWait(vrows: readonly VelocityRow[]): { work: StageAverage[]; gate: number; queue: number; waitShare: number } {
  const avg = stageAverages(vrows);
  const gate = avg.filter((a) => a.kind === "gate").reduce((s, a) => s + a.average, 0), queue = avg.filter((a) => a.kind === "queue").reduce((s, a) => s + a.average, 0);
  const work = avg.filter((a) => a.kind === "work");
  const all = work.reduce((s, a) => s + a.average, 0) + gate + queue;
  return { work, gate, queue, waitShare: all === 0 ? 0 : (gate + queue) / all };
}
export type StageGroup = { key: string; n: number; stages: StageAverage[]; total: number };
/** The stage averages per value of a dimension; groups of fewer than 3 are left out. */
export function stagesBy(vrows: readonly VelocityRow[], dim: ReportDim, ctx: ReportCtx = {}): StageGroup[] {
  const by = new Map<string, VelocityRow[]>();
  for (const v of vrows) { if (v.value === null) continue; for (const k of valuesOf(v.row, dim, ctx)) (by.get(k) ?? by.set(k, []).get(k)!).push(v); }
  return [...by].filter(([, vs]) => vs.length >= 3).map(([key, vs]) => { const stages = stageAverages(vs); return { key, n: vs.length, stages, total: stages.reduce((s, a) => s + a.average, 0) }; }).sort((a, b) => b.total - a.total);
}

// ---- decisions: from the request to the decision, per gate (team level, never per approver)
export type DecisionStat = {
  gate: GateId;
  /** Days from request to decision, for decided requests. */
  stats: Stats | null;
  /** Requests still waiting, longest first. */
  open: { itemId: string; days: number }[];
  outcomes: Record<GateOutcome, number>;
};
export function decisionStats(requests: readonly GateRequest[], itemIds: ReadonlySet<string>, today: number): DecisionStat[] {
  return (["A", "B", "C"] as const).map((gate) => {
    const mine = requests.filter((r) => r.kind === "decision" && r.gate === gate && itemIds.has(r.item_id));
    const took = mine.filter((r) => r.decided_at).map((r) => Math.max(0, day(r.decided_at) - day(r.requested_at))).filter((d) => !Number.isNaN(d));
    const open = mine.filter((r) => !r.decided_at && !r.withdrawn_at).map((r) => ({ itemId: r.item_id, days: Math.max(0, today - day(r.requested_at)) })).sort((a, b) => b.days - a.days);
    const outcomes: Record<GateOutcome, number> = { go: 0, go_with_conditions: 0, hold: 0, stop: 0 };
    for (const r of mine) if (r.decided_at && r.outcome) outcomes[r.outcome] += 1;
    return { gate, stats: statsOf(took), open, outcomes };
  });
}

// ---- sub-phases of development: Build, Test, Experiment
export const SUB_PHASES = [
  { id: "build", label: "Build", from: "build", to: "test" },
  { id: "test", label: "Test", from: "test", to: "exp" },
  { id: "experiment", label: "Experiment", from: "exp", to: "cReq" },
] as const satisfies readonly { id: string; label: string; from: Milestone; to: Milestone }[];
export type SubPhaseId = (typeof SUB_PHASES)[number]["id"];

/** Days a finished sub-phase took; null while it has not ended, or when the initiative skipped it. Build is the tracker's Actual Build when it has one. */
export function subPhaseDays(v: VelocityRow, id: SubPhaseId, today: number): number | null {
  const sp = SUB_PHASES.find((s) => s.id === id)!;
  if (id === "build") { const b = buildTimeOf(v.row); if (b && day(b.start) + b.days <= today) return b.days; }
  if (v.journey.raw[sp.from] === undefined) return null; // skipped
  const a = v.journey.filled[sp.from], b = v.journey.filled[sp.to];
  return a === null || b === null || b > today || b < a ? null : b - a;
}
export type SubPhaseStat = { id: SubPhaseId; label: string; stats: Stats | null };
export function subPhaseStats(vrows: readonly VelocityRow[], today: number): SubPhaseStat[] {
  return SUB_PHASES.map((sp) => ({ id: sp.id, label: sp.label, stats: statsOf(vrows.map((v) => subPhaseDays(v, sp.id, today)).filter((d): d is number => d !== null)) }));
}
/** Median days per size and sub-phase; a cell needs 3 or more initiatives. */
export function subPhaseBySize(vrows: readonly VelocityRow[], today: number): { size: string; cells: Record<SubPhaseId, { n: number; median: number | null }> }[] {
  return SIZES.map((size) => {
    const cells = {} as Record<SubPhaseId, { n: number; median: number | null }>;
    for (const sp of SUB_PHASES) {
      const xs = vrows.filter((v) => sizeOf(v) === size).map((v) => subPhaseDays(v, sp.id, today)).filter((d): d is number => d !== null);
      cells[sp.id] = { n: xs.length, median: xs.length >= 3 ? percentile(sorted(xs), 0.5) : null };
    }
    return { size, cells };
  });
}

// ---- in flight and already slower than usual (for the measure chosen)
export type SlowInFlight = { id: string; elapsed: number; usual: number; over: number; stage: StageId; daysInStage: number };
/**
 * Started the measure, not at its end yet, not cancelled or completed, and already past the time 80% of the finished initiatives of the same size needed
 * for the same measure (all sizes together when that size has fewer than 5, and only when at least 5 have finished). `rows` are all initiatives of the filters.
 */
export function inFlightSlow(rows: readonly ReportRow[], requests: readonly GateRequest[], settings: VelocitySettings, today: number): SlowInFlight[] {
  const vr = velocityRows(rows, requests, settings, today);
  const finished = vr.filter((v) => v.complete && v.value !== null);
  const all = statsOf(finished.map((v) => v.value!));
  const bySize = new Map<string, number>();
  for (const sz of SIZES) { const s = statsOf(finished.filter((v) => sizeOf(v) === sz).map((v) => v.value!)); if (s && s.n >= 5) bySize.set(sz, s.p80); }
  const out: SlowInFlight[] = [];
  for (const v of vr) {
    const status = typeof v.row.initiative_status === "string" ? v.row.initiative_status : "";
    if (v.complete || v.start === null || v.start > today || status === "Cancelled" || status === "Completed") continue;
    const usual = bySize.get(sizeOf(v)) ?? (all && all.n >= 5 ? all.p80 : undefined);
    const elapsed = today - v.start;
    if (usual === undefined || elapsed <= usual) continue;
    const stage = STAGES.find((s) => { const a = v.journey.filled[s.from], b = v.journey.filled[s.to]; return a !== null && a <= today && (b === null || b > today); }) ?? STAGES[0];
    out.push({ id: v.id, elapsed, usual, over: elapsed - usual, stage: stage.id, daysInStage: today - (v.journey.filled[stage.from] ?? v.start) });
  }
  return out.sort((a, b) => b.elapsed / b.usual - a.elapsed / a.usual);
}

// ---- each phase of the measure on its own
export type PhaseStat = { id: StageId; label: string; kind: StageKind; /** Initiatives with dates for this phase. */ n: number; /** Initiatives that count for the measure. */ of: number; stats: Stats | null };
/** Average, median and percentiles of each phase of the measure, over the initiatives that have dates for that phase (so a missing date never pulls a phase towards zero). */
export function phaseStats(vrows: readonly VelocityRow[], settings: VelocitySettings): PhaseStat[] {
  const counted = vrows.filter((v) => v.value !== null);
  return measureStages(settings).map((id) => {
    const st = STAGES.find((s) => s.id === id)!;
    const xs = counted.filter((v) => v.known.includes(id)).map((v) => v.spans[id]!.end - v.spans[id]!.start);
    return { id, label: st.label, kind: st.kind, n: xs.length, of: counted.length, stats: statsOf(xs) };
  });
}
