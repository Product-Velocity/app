import { toDay, type Bar, type GanttRow } from "./gantt";

/**
 * What the Gantt shows besides the bars, with no UI in it (issue 600): planned against actual, dependency lines from
 * `depends_on`, the chain of items behind a bar, gate markers and the roll-up of a group. Team-level and read only:
 * nothing here is a per-person measure and nothing changes a gate or a tracker-driven field.
 */
const DAY_MS = 86_400_000;
const todayDay = (d: Date) => Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
const dayOf = (v: unknown) => (typeof v === "string" ? toDay(v) : NaN);
const orNull = (n: number) => (Number.isNaN(n) ? null : n);
export const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Phases that end the work: an initiative in one of them is not "overdue" however old its G2M date is. */
export const ENDED_PHASES: readonly string[] = ["Completed", "Sunset"];

// ------------------------------------------------------------------ planned against actual
export type PlanStatus = {
  /** Actual start (Start Date) and actual end (G2M Date (actual)), as days; null when not known. */
  actualStart: number | null;
  actualEnd: number | null;
  /** The thin "actual" line under the bar: from the actual start to the actual end, or to today while it runs. */
  actualLine: { startDay: number; endDay: number; running: boolean } | null;
  /** Days the start came after the plan (negative: earlier); null without an actual start. */
  startSlip: number | null;
  /** Days the finish came after G2M Date (est) (negative: earlier); null until it finished. */
  endSlip: number | null;
  /** Days past G2M Date (est) with no finish and no ending phase; null when not overdue. */
  overdue: number | null;
  /** Days past Planned Start with no actual start and not ended; null otherwise. */
  startLate: number | null;
  ended: boolean;
  /** One short sentence each, in the words the hover card, the label and the screen reader use. */
  notes: string[];
};

export function planVsActual(row: GanttRow, bar: Pick<Bar, "startDay" | "endDay">, today: Date): PlanStatus {
  const t = todayDay(today);
  const actualStart = orNull(dayOf(row.start_date));
  const actualEnd = orNull(dayOf(row.g2m_date_actual));
  const phase = typeof row.initiative_phase === "string" ? row.initiative_phase : "";
  const ended = actualEnd !== null || ENDED_PHASES.includes(phase);
  const startSlip = actualStart === null ? null : actualStart - bar.startDay;
  const endSlip = actualEnd === null ? null : actualEnd - bar.endDay;
  const overdue = !ended && bar.endDay < t ? t - bar.endDay : null;
  const startLate = !ended && actualStart === null && bar.startDay < t ? t - bar.startDay : null;
  const lineEnd = actualEnd ?? (ended ? null : t);
  const actualLine = actualStart !== null && lineEnd !== null && lineEnd >= actualStart ? { startDay: actualStart, endDay: lineEnd, running: actualEnd === null } : null;
  const notes: string[] = [];
  if (startSlip !== null) notes.push(startSlip === 0 ? "Started on plan" : startSlip > 0 ? `Started ${daysText(startSlip)} late` : `Started ${daysText(-startSlip)} early`);
  else if (startLate !== null) notes.push(`Not started, ${daysText(startLate)} after Planned Start`);
  if (endSlip !== null) notes.push(endSlip === 0 ? "Finished on plan" : endSlip > 0 ? `Finished ${daysText(endSlip)} late` : `Finished ${daysText(-endSlip)} early`);
  else if (overdue !== null) notes.push(`Overdue by ${daysText(overdue)}`);
  return { actualStart, actualEnd, actualLine, startSlip, endSlip, overdue, startLate, ended, notes };
}

// ------------------------------------------------------------------ dependencies (depends_on)
/** "R-12; R-20" (or commas, or new lines) into codes. */
export function parseDeps(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return [...new Set(v.split(/[;,\n]+/).map((s) => s.trim()).filter(Boolean))];
}

/** `from` must finish before `to` can start. `clash`: it ends on or after the day `to` starts. */
export type Edge = { from: string; to: string; clash: boolean };
export type DepGraph = {
  edges: Edge[];
  /** Per item: the codes it depends on that have no bar here (not scheduled, filtered out, or unknown). */
  unplaced: Map<string, string[]>;
  /** Per item: how many dependencies there are (placed or not), and how many clash. */
  counts: Map<string, { total: number; clashes: number }>;
};

export function buildDeps(rows: readonly GanttRow[], bars: readonly Bar[]): DepGraph {
  const barOf = new Map(bars.map((b) => [b.id, b]));
  const byCode = new Map<string, GanttRow>();
  for (const r of rows) if (typeof r.item_code === "string") byCode.set(r.item_code, r);
  const edges: Edge[] = [];
  const unplaced = new Map<string, string[]>();
  const counts = new Map<string, { total: number; clashes: number }>();
  for (const r of rows) {
    const codes = parseDeps(r.depends_on).filter((c) => c !== r.item_code);
    if (codes.length === 0) continue;
    const mine = barOf.get(r.id);
    let clashes = 0;
    for (const code of codes) {
      const pred = byCode.get(code);
      const pb = pred ? barOf.get(pred.id) : undefined;
      if (!pred || !pb || !mine) { unplaced.set(r.id, [...(unplaced.get(r.id) ?? []), code]); continue; }
      const clash = pb.endDay >= mine.startDay;
      if (clash) clashes++;
      edges.push({ from: pred.id, to: r.id, clash });
    }
    counts.set(r.id, { total: codes.length, clashes });
  }
  return { edges, unplaced, counts };
}

/** The item with everything upstream (what it waits for) and downstream (what waits for it), and the edges between them. */
export function chainOf(edges: readonly Edge[], id: string): { ids: Set<string>; edges: Set<Edge> } {
  const ids = new Set([id]);
  const keep = new Set<Edge>();
  const walk = (dir: "up" | "down") => {
    const queue = [id];
    const seen = new Set([id]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        const next = dir === "up" ? (e.to === cur ? e.from : null) : (e.from === cur ? e.to : null);
        if (next === null) continue;
        keep.add(e);
        if (!seen.has(next)) { seen.add(next); ids.add(next); queue.push(next); }
      }
    }
  };
  walk("up"); walk("down");
  return { ids, edges: keep };
}

// ------------------------------------------------------------------ gates and group roll-up
export type GateMarker = { day: number; gate: string; status: string; text: string };
/** The next decision gate as a marker on the item's row (read only). Null without a gate date. */
export function gateMarker(row: GanttRow): GateMarker | null {
  const day = orNull(dayOf(row.next_gate_due));
  if (day === null) return null;
  const gate = typeof row.current_gate === "string" && row.current_gate ? row.current_gate : "";
  const status = typeof row.gate_status === "string" ? row.gate_status : "";
  return { day, gate, status, text: `${gate ? `Gate ${gate}` : "Gate"}${status ? `, ${status}` : ""}, due ${row.next_gate_due as string}` };
}

export type Rollup = { atRisk: number; late: number; blocked: number; progress: number | null; text: string };
/** At Risk and Blocked are the Health values people set; late is computed from the dates (see `planVsActual`). Team-level only. */
export function rollup(rows: readonly GanttRow[], barOf: ReadonlyMap<string, Bar>, today: Date): Rollup {
  let atRisk = 0, late = 0, blocked = 0, sum = 0, withProgress = 0;
  for (const r of rows) {
    const bar = barOf.get(r.id);
    if (r.health === "At Risk") atRisk++;
    if (r.health === "Blocked") blocked++;
    if (bar && planVsActual(r, bar, today).overdue !== null) late++;
    if (typeof r.delivery_progress_pct === "number") { sum += Math.max(0, Math.min(100, r.delivery_progress_pct)); withProgress++; }
  }
  const progress = withProgress ? Math.round(sum / withProgress) : null;
  const parts = [atRisk && `${atRisk} at risk`, late && `${late} late`, blocked && `${blocked} blocked`].filter(Boolean) as string[];
  return { atRisk, late, blocked, progress, text: parts.length ? parts.join(", ") : "No flags" };
}
