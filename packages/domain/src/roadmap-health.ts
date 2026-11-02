import { FIELD_BY_KEY } from "./registry";
import { toDay } from "./gantt";
import { PHASE_STARTS } from "./time-to-market";
import type { ReportRow } from "./reports";

/**
 * Roadmap Health report (request R-129, issue #287): where work piles up and which initiatives have been in a phase for a long time.
 * Pure functions over the rows the grid already holds. Definitions (decision 2026-11-02-roadmap-health):
 *  - active: Initiative Status = Active;
 *  - needs attention: Health is Blocked, At Risk or Delayed (three separate counts);
 *  - days in current phase: today minus the start date of the current phase (Start Discovery ... Start Roll-Out), else the day Phase Changed At;
 *  - age: today minus Start Date, else Planned Start;
 *  - a row with no usable date (empty, invalid or in the future) is counted as "no date", never dropped silently.
 */
const DAY_MS = 86_400_000;
const dayOf = (v: unknown) => (typeof v === "string" ? toDay(v.slice(0, 10)) : NaN);
export const dayNumber = (d: Date) => Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);

export const NEEDS_ATTENTION = ["Blocked", "At Risk", "Delayed"] as const;
export type NeedsAttention = (typeof NEEDS_ATTENTION)[number];

export const isActive = (r: ReportRow) => r.initiative_status === "Active";
export const isCompleted = (r: ReportRow) => r.initiative_status === "Completed";

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length === 0 ? null : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const average = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Days since the current phase began; null when there is no usable date. */
export function daysInPhase(row: ReportRow, today: number): number | null {
  const own = PHASE_STARTS.find((p) => p.phase === row.initiative_phase);
  const start = [own ? dayOf(row[own.field]) : NaN, dayOf(row.phase_changed_at)].find((d) => !Number.isNaN(d));
  return start === undefined || today < start ? null : today - start;
}

/** Days since the work started (Start Date, else Planned Start); null when there is no usable date. */
export function ageDays(row: ReportRow, today: number): number | null {
  const start = [dayOf(row.start_date), dayOf(row.planned_start)].find((d) => !Number.isNaN(d));
  return start === undefined || today < start ? null : today - start;
}

export type ActiveHealthCounts = { active: number; counts: Record<NeedsAttention, number>; needAttention: number };
/** How many active initiatives there are and how many are Blocked, At Risk or Delayed (of the rows given, active ones only). */
export function healthCounts(rows: readonly ReportRow[]): ActiveHealthCounts {
  const counts: Record<NeedsAttention, number> = { Blocked: 0, "At Risk": 0, Delayed: 0 };
  let active = 0;
  for (const r of rows) {
    if (!isActive(r)) continue;
    active += 1;
    if ((NEEDS_ATTENTION as readonly unknown[]).includes(r.health)) counts[r.health as NeedsAttention] += 1;
  }
  return { active, counts, needAttention: counts.Blocked + counts["At Risk"] + counts.Delayed };
}

export type PhaseAging = { phase: string; count: number; withDate: number; missing: number; median: number | null; average: number | null; max: number | null };
export type AgingSummary = {
  active: number; withDate: number; missing: number; median: number | null; ageMedian: number | null; ageMissing: number; phases: PhaseAging[];
};

/** Days in the current phase of the active initiatives, overall and per phase (dictionary order, "Not set" last). Nothing is dropped: rows without a date are counted as missing. */
export function agingSummary(rows: readonly ReportRow[], today: number): AgingSummary {
  const by = new Map<string, { n: number; days: number[] }>();
  const all: number[] = [], ages: number[] = [];
  let active = 0;
  for (const r of rows) {
    if (!isActive(r)) continue;
    active += 1;
    const phase = typeof r.initiative_phase === "string" && r.initiative_phase ? r.initiative_phase : "Not set";
    const g = by.get(phase) ?? { n: 0, days: [] };
    g.n += 1;
    const d = daysInPhase(r, today);
    if (d !== null) { g.days.push(d); all.push(d); }
    by.set(phase, g);
    const a = ageDays(r, today);
    if (a !== null) ages.push(a);
  }
  const order = FIELD_BY_KEY.initiative_phase?.allowed ?? [];
  const rank = (p: string) => (p === "Not set" ? 99 : order.indexOf(p) === -1 ? 98 : order.indexOf(p));
  const phases = [...by].sort((a, b) => rank(a[0]) - rank(b[0])).map(([phase, g]) => ({
    phase, count: g.n, withDate: g.days.length, missing: g.n - g.days.length, median: median(g.days), average: average(g.days), max: g.days.length ? Math.max(...g.days) : null,
  }));
  return { active, withDate: all.length, missing: active - all.length, median: median(all), ageMedian: median(ages), ageMissing: active - ages.length, phases };
}

export type Waiting = { id: string; days: number };
/** The active initiatives that have been in their current phase the longest, longest first. */
export function longestInPhase(rows: readonly ReportRow[], today: number, limit = 10): Waiting[] {
  const out: Waiting[] = [];
  for (const r of rows) {
    if (!isActive(r)) continue;
    const d = daysInPhase(r, today);
    if (d !== null) out.push({ id: r.id, days: d });
  }
  return out.sort((a, b) => b.days - a.days || a.id.localeCompare(b.id)).slice(0, limit);
}
