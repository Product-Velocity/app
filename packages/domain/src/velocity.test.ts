import { describe, expect, it } from "vitest";
import { fromDay, toDay } from "./gantt";
import type { GateOutcome, GateRequest } from "./gates";
import {
  STAGES, bellCurve, decisionStats, groupStats, histogram, inFlightSlow, journeyOf, percentile, recentChange, sizeStats, stageAverages, stageDays, stagesBy, statsOf, subPhaseBySize, subPhaseDays,
  subPhaseStats, trendByQuarter, velocityRows, velocitySummary, windowCoverage, workWait, type VelocityRow, type VelocitySettings,
} from "./velocity";
import type { ReportRow } from "./reports";

const D0 = toDay("2026-01-05");
const iso = (n: number) => fromDay(D0 + n);
const TODAY = D0 + 400;

type Days = { start?: number; def?: number; build?: number; test?: number; exp?: number; roll?: number };
const row = (id: string, d: Days, extra: Record<string, unknown> = {}): ReportRow => ({
  id,
  start_discovery: d.start === undefined ? undefined : iso(d.start), start_definition: d.def === undefined ? undefined : iso(d.def), start_building: d.build === undefined ? undefined : iso(d.build),
  start_beta: d.test === undefined ? undefined : iso(d.test), start_experiment: d.exp === undefined ? undefined : iso(d.exp), start_rollout: d.roll === undefined ? undefined : iso(d.roll), ...extra,
});
const req = (item: string, gate: "A" | "B" | "C", requested: number, decided: number | null, outcome: GateOutcome | null = "go", kind: "decision" | "skipped" = "decision"): GateRequest => ({
  id: `${item}-${gate}-${requested}`, item_id: item, gate, kind, requested_by: null, requested_at: `${iso(requested)}T09:00:00Z`, preferred_approvers: [], ready: true, criteria: [], outcome,
  rationale: null, fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: decided === null ? null : `${iso(decided)}T09:00:00Z`, withdrawn_at: null,
});
const total: VelocitySettings = { measure: "total", stretch: false };

/** The full journey of the notes below: Discover 10, wait A 4, Define 16, wait B 5, queue 10, Build 35, Test 10, Experiment 20, wait C 7, queue 3 = 120 days. */
const full = (id: string, extra: Record<string, unknown> = {}, shift = 0) => ({
  row: row(id, { start: shift, def: shift + 14, build: shift + 45, test: shift + 80, exp: shift + 90, roll: shift + 120 }, extra),
  requests: [req(id, "A", shift + 10, shift + 14), req(id, "B", shift + 30, shift + 35), req(id, "C", shift + 110, shift + 117)],
});

describe("journeyOf", () => {
  it("takes the dates of the gate decisions and of the phase starts", () => {
    const f = full("a");
    const j = journeyOf(f.row, f.requests);
    expect(j.raw).toEqual({ start: D0, aReq: D0 + 10, a: D0 + 14, bReq: D0 + 30, b: D0 + 35, build: D0 + 45, test: D0 + 80, exp: D0 + 90, cReq: D0 + 110, c: D0 + 117, roll: D0 + 120 });
  });
  it("uses the earlier of Start Discovery and Start Date", () => {
    expect(journeyOf(row("a", { start: 20 }, { start_date: iso(12) })).raw.start).toBe(D0 + 12);
  });
  it("uses the latest passing decision, never a Hold or a fast-lane skip", () => {
    const rs = [req("a", "B", 20, 22, "hold"), req("a", "B", 30, 35, "go_with_conditions"), req("a", "B", 36, 37, "go"), req("a", "B", 5, 6, null, "skipped")];
    const j = journeyOf(row("a", { build: 50 }), rs);
    expect(j.raw).toMatchObject({ bReq: D0 + 36, b: D0 + 37 });
  });
  it("without a gate decision, falls back to the date the phase started, and a missing request runs the stage before it on", () => {
    const j = journeyOf(row("a", { start: 0, def: 14, build: 45, roll: 120 }));
    expect(j.raw).toMatchObject({ a: D0 + 14, b: D0 + 45, c: D0 + 120 });
    expect(j.raw.aReq).toBeUndefined();
    expect(j.filled.aReq).toBe(D0 + 14);
  });
  it("a skipped phase takes the next date, so the one before it runs on", () => {
    const f = full("a");
    const j = journeyOf({ ...f.row, start_beta: undefined, start_experiment: undefined }, f.requests);
    expect(j.filled.test).toBe(D0 + 110);
    expect(j.filled.exp).toBe(D0 + 110);
    expect(j.raw.test).toBeUndefined();
  });
  it("never goes backwards and leaves the end open after the last date", () => {
    const j = journeyOf(row("a", { start: 10, def: 5, build: 30 }));
    expect(j.filled.a).toBe(D0 + 10);
    expect(j.filled.build).toBe(D0 + 30);
    expect(j.filled.roll).toBeNull();
  });
});

describe("velocityRows: the value of each measure", () => {
  const f = full("a");
  const rows = (s: VelocitySettings, r = [f.row], q = f.requests) => velocityRows(r, q, s, TODAY);
  it("Total is Start Discovery to Start Roll-Out; the days after roll-out are not counted", () => {
    expect(rows(total)[0]!.value).toBe(120);
  });
  it("To Gate A, B and C end at the gate decisions", () => {
    expect(rows({ measure: "gate_a", stretch: false })[0]!.value).toBe(14);
    expect(rows({ measure: "gate_b", stretch: false })[0]!.value).toBe(35);
    expect(rows({ measure: "gate_c", stretch: false })[0]!.value).toBe(117);
  });
  it("counted from the previous gate starts at that decision (Gate B and C only)", () => {
    expect(rows({ measure: "gate_b", stretch: true })[0]!.value).toBe(21);
    expect(rows({ measure: "gate_c", stretch: true })[0]!.value).toBe(82);
    expect(rows({ measure: "gate_a", stretch: true })[0]!.value).toBe(14);
    expect(rows({ measure: "total", stretch: true })[0]!.value).toBe(120);
  });
  it("Build is the Actual Build the grid shows", () => {
    const r = { ...f.row, time_building_days: 35, actual_build_weeks: 5 };
    expect(rows({ measure: "build", stretch: false }, [r])[0]).toMatchObject({ value: 35, start: D0 + 45, end: D0 + 80 });
  });
  it("is null, never zero, while the end has not been reached", () => {
    const early = row("b", { start: 100, def: 110 });
    const [a, b, c] = velocityRows([early, row("c", {}), row("d", { start: 0, roll: 500 })], [], total, TODAY);
    expect([a!.value, b!.value, c!.value]).toEqual([null, null, null]); // still on the way, no start, end in the future
  });
  it("is not counted when the end is before the start", () => {
    expect(velocityRows([row("a", { start: 10, def: 5 })], [], { measure: "gate_a", stretch: false }, TODAY)[0]!.value).toBeNull();
  });
  it("counted from the previous gate needs that gate", () => {
    expect(velocityRows([row("a", { start: 0, build: 45 })], [], { measure: "gate_b", stretch: true }, TODAY)[0]!.value).toBeNull();
  });
});

describe("numbers", () => {
  it("percentiles interpolate and the stats have the middle half and the tails", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.5)).toBeNull();
    const s = statsOf([10, 20, 30, 40, 50])!;
    expect(s).toMatchObject({ n: 5, min: 10, max: 50, median: 30, average: 30, p25: 20, p75: 40 });
    expect(s.p10).toBeCloseTo(14);
    expect(s.p90).toBeCloseTo(46);
    expect(statsOf([])).toBeNull();
  });
  it("the summary counts the finished, the ones still on the way and the ones with no start apart", () => {
    const vr = velocityRows([full("a").row, full("b", {}, 5).row, row("c", { start: 300 }), row("d", {})], [], total, TODAY);
    expect(velocitySummary(vr)).toMatchObject({ counted: 2, notThere: 1, noStart: 1 });
    expect(velocitySummary(vr).stats!.median).toBe(120); // both journeys take 120 days
    expect(velocitySummary([])).toMatchObject({ counted: 0, stats: null });
  });
});

describe("windowCoverage: what the dates allow", () => {
  it("counts the initiatives with a start, an end and both for the measure, so an empty chart can say why", () => {
    const rows = [row("a", { start: 0, roll: 50 }), row("b", { start: 0 }), row("c", { roll: 50 }), row("d", { build: 5 })];
    expect(windowCoverage(velocityRows(rows, [], total, TODAY))).toEqual({ initiatives: 4, withStart: 2, withEnd: 2, withBoth: 1 });
    const none = windowCoverage(velocityRows([row("x", { build: 5 }), row("y", { build: 9 })], [], total, TODAY));
    expect(none).toEqual({ initiatives: 2, withStart: 0, withEnd: 0, withBoth: 0 });
  });
});

describe("histogram and bell", () => {
  const values = [5, 6, 6, 7, 7, 7, 8, 8, 9, 10, 12, 15, 21, 30];
  it("puts every value in a bar, in zones that follow the percentiles", () => {
    const h = histogram(values)!;
    expect(h.bins.reduce((a, b) => a + b.count, 0)).toBe(values.length);
    expect(h.bins[0]!.zone).toBeLessThanOrEqual(1);
    expect(h.bins[h.bins.length - 1]!.zone).toBe(4);
    expect(h.bins.every((b, i) => i === 0 || b.zone >= h.bins[i - 1]!.zone)).toBe(true); // faster to slower, never back
    expect(h.bins.some((b) => b.zone === 2)).toBe(true);
    expect(h.bins.every((b) => Math.abs(b.to - b.from - h.width) < 1e-9)).toBe(true);
  });
  it("has nothing for no values, and a single bar for one value", () => {
    expect(histogram([])).toBeNull();
    expect(histogram([4])!.bins).toHaveLength(1);
  });
  it("the curve covers the range and is never negative", () => {
    const h = histogram(values)!;
    const c = bellCurve(values, h.bins[0]!.from, h.bins[h.bins.length - 1]!.to, h.width);
    expect(c).toHaveLength(81);
    expect(c.every((p) => p.y >= 0)).toBe(true);
    expect(Math.max(...c.map((p) => p.y))).toBeGreaterThan(0);
    expect(bellCurve([], 0, 10, 1)).toEqual([]);
  });
});

describe("groups", () => {
  const mk = (id: string, days: number, extra: Record<string, unknown>) => row(id, { start: 0, roll: days }, extra);
  const rows = [
    mk("1", 10, { effort: "S", contributing_teams: "Core" }), mk("2", 12, { effort: "S", contributing_teams: "Core, Mobile" }), mk("3", 14, { effort: "S", contributing_teams: "Core" }),
    mk("4", 40, { effort: "L", contributing_teams: "Mobile" }), mk("5", 50, { effort: "L", contributing_teams: "Mobile" }), mk("6", 60, { effort: "L", contributing_teams: "Mobile" }),
    mk("7", 30, { effort: "M" }),
  ];
  const vr = velocityRows(rows, [], total, TODAY);
  const ctx = { teamNames: ["Core", "Mobile"] };
  it("per team, slowest first, an initiative with two teams counted once for each, not set last", () => {
    const g = groupStats(vr, "team", ctx);
    expect(g.map((x) => [x.key, x.n])).toEqual([["Mobile", 4], ["Core", 3], ["__none", 1]]);
  });
  it("sizes come in their own order and leave out the ones with no data", () => {
    expect(sizeStats(vr).map((x) => [x.key, x.n, x.stats.median])).toEqual([["S", 3, 12], ["M", 1, 30], ["L", 3, 50]]);
  });
  it("compares a group with what its own mix of sizes predicts", () => {
    // Mobile does mostly large work: its median (50) is close to the median of L (50), so it is not slow for its sizes
    const mobile = groupStats(vr, "team", ctx).find((g) => g.key === "Mobile")!;
    expect(mobile.stats.median).toBe(45);
    expect(mobile.adjusted).toBeGreaterThan(0.85);
    expect(mobile.adjusted).toBeLessThan(1.05);
    // an S initiative that took as long as the larger ones is slow for its size
    const slowS = velocityRows([...rows, mk("8", 60, { effort: "S", contributing_teams: "Growth" })], [], total, TODAY);
    expect(groupStats(slowS, "team", { teamNames: ["Core", "Mobile", "Growth"] }).find((g) => g.key === "Growth")!.adjusted).toBeGreaterThan(4);
  });
  it("keeps the values of a small group for the dots", () => {
    expect(groupStats(vr, "effort", {}).find((g) => g.key === "M")!.values).toEqual([30]);
  });
  it("splits by Objective, Key Result and Business Line like any other dimension", () => {
    const withKr = velocityRows([mk("1", 10, { kr_metric: "A" }), mk("2", 20, { kr_metric: "B" }), mk("3", 30, { kr_metric: "B" })], [], total, TODAY);
    expect(groupStats(withKr, "key_result").map((g) => [g.key, g.n])).toEqual([["B", 2], ["A", 1]]);
  });
});

describe("trend", () => {
  const mk = (id: string, start: number, end: number) => row(id, { start, roll: end });
  // finished in the first quarter of 2026 (days 0 to 85): three; second quarter: three; fourth quarter: one (left out)
  const vr = velocityRows([
    mk("1", 0, 30), mk("2", 5, 45), mk("3", 10, 50), mk("4", 20, 120), mk("5", 30, 130), mk("6", 40, 140), mk("7", 0, 300),
  ], [], total, TODAY);
  it("groups by the quarter in which the measure ended, in time order, and leaves out quarters with fewer than 3", () => {
    const t = trendByQuarter(vr);
    expect(t.map((q) => [q.quarter, q.n])).toEqual([["Q1 2026", 3], ["Q2 2026", 3]]);
    expect(t[0]!.median).toBe(40);
  });
  it("the recent change needs three quarters and 5 initiatives on each side", () => {
    expect(recentChange(vr)).toBeNull();
    const more = velocityRows([
      ...[0, 1, 2, 3, 4, 5].map((i) => mk(`a${i}`, 0, 20 + i)), ...[0, 1, 2].map((i) => mk(`b${i}`, 0, 100 + i)), ...[0, 1, 2].map((i) => mk(`c${i}`, 0, 190 + i)), ...[0, 1, 2].map((i) => mk(`d${i}`, 0, 280 + i)),
    ], [], total, TODAY);
    const c = recentChange(more)!;
    expect(c.recent).toBeGreaterThan(c.before);
    expect(c.ratio).toBeCloseTo(c.recent / c.before);
  });
});

describe("where the time goes", () => {
  const f = full("a");
  const vr = velocityRows([f.row], f.requests, total, TODAY);
  it("splits a journey into stages that add up to the measure", () => {
    const d = stageDays(vr[0]!);
    expect(d).toEqual({ discover: 10, wait_a: 4, define: 16, wait_b: 5, queue_build: 10, build: 35, test: 10, experiment: 20, wait_c: 7, queue_roll: 3 });
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBe(120);
  });
  it("only counts the part of a stage inside the window of the measure", () => {
    const gb = velocityRows([f.row], f.requests, { measure: "gate_b", stretch: false }, TODAY)[0]!;
    const d = stageDays(gb);
    expect(d.discover + d.wait_a + d.define + d.wait_b).toBe(35);
    expect(d.queue_build + d.build + d.test + d.experiment + d.wait_c + d.queue_roll).toBe(0);
    const stretch = stageDays(velocityRows([f.row], f.requests, { measure: "gate_b", stretch: true }, TODAY)[0]!);
    expect(stretch.define + stretch.wait_b).toBe(21);
    expect(stretch.discover + stretch.wait_a).toBe(0);
  });
  it("without gate requests the waits are zero and the work stage before them runs on; a skipped phase is zero", () => {
    const r = velocityRows([row("b", { start: 0, def: 14, build: 45, roll: 120 })], [], total, TODAY)[0]!;
    const d = stageDays(r);
    expect(d.wait_a + d.wait_b + d.wait_c).toBe(0);
    expect(d.discover).toBe(14);
    expect(d.test + d.experiment).toBe(0);
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBe(120);
  });
  it("averages over the counted initiatives, and the stage kinds say what is waiting", () => {
    const two = velocityRows([f.row, full("b", {}, 5).row], [...f.requests, ...full("b", {}, 5).requests], total, TODAY);
    const avg = stageAverages(two);
    expect(avg.find((a) => a.id === "build")!.average).toBe(35);
    expect(avg.reduce((a, b) => a + b.average, 0)).toBe(120);
    const w = workWait(two);
    expect(w.gate).toBe(16);
    expect(w.queue).toBe(13);
    expect(w.waitShare).toBeCloseTo(29 / 120);
    expect(w.work.map((x) => x.id)).toEqual(["discover", "define", "build", "test", "experiment"]);
    expect(STAGES.filter((s) => s.kind === "gate").map((s) => s.id)).toEqual(["wait_a", "wait_b", "wait_c"]);
  });
  it("by group, leaving out groups of fewer than 3", () => {
    const rows = [1, 2, 3].map((i) => full(`t${i}`, { contributing_teams: "Core" }, i)).concat([full("m", { contributing_teams: "Mobile" })]);
    const g = stagesBy(velocityRows(rows.map((r) => r.row), rows.flatMap((r) => r.requests), total, TODAY), "team", { teamNames: ["Core", "Mobile"] });
    expect(g.map((x) => [x.key, x.n, x.total])).toEqual([["Core", 3, 120]]);
  });
  it("an initiative with only Start Building spends its build time in Build (a stage with no later date runs to the end of the measure)", () => {
    const only = { ...row("c", { build: 10 }), time_building_days: 49, actual_build_weeks: 7 };
    const r = velocityRows([only], [], { measure: "build", stretch: false }, TODAY)[0]!;
    expect(r.value).toBe(49);
    const d = stageDays(r);
    expect(d.build).toBe(49);
    expect(Object.values(d).reduce((x, y) => x + y, 0)).toBe(49);
    expect(workWait([r]).waitShare).toBe(0);
    expect(stageAverages([r]).find((x) => x.id === "build")!.average).toBe(49);
  });
  it.each([["every later phase has the same date as Start Building", { build: 10, test: 10, exp: 10, roll: 10 }], ["the later phases are dated before the build time ends", { build: 10, test: 12, exp: 15, roll: 20 }]])("the stages add up to the build time when %s", (_n, days) => {
    const odd = { ...row("d", days), time_building_days: 49, actual_build_weeks: 7 };
    const r = velocityRows([odd], [], { measure: "build", stretch: false }, TODAY)[0]!;
    expect(r.value).toBe(49);
    const d = stageDays(r);
    expect(Object.values(d).reduce((x, y) => x + y, 0)).toBe(49);
    expect(d.build).toBeGreaterThan(0);
    expect(stageAverages([r]).find((x) => x.id === "build")!.average).toBeGreaterThan(0);
  });
  it("has no averages for no initiatives", () => {
    expect(stageAverages([]).every((a) => a.average === 0)).toBe(true);
    expect(workWait([]).waitShare).toBe(0);
  });
});

describe("decisions", () => {
  const rs = [
    req("a", "A", 0, 3), req("b", "A", 0, 5), req("c", "A", 0, 10, "hold"), req("d", "A", 390, null), req("e", "A", 0, 99, "go"), req("a", "B", 10, 20, "stop"), req("a", "A", 0, null, null, "skipped"),
  ];
  it("counts days from request to decision per gate, the open requests longest first and the outcomes; only the initiatives asked for", () => {
    const all = decisionStats(rs, new Set(["a", "b", "c", "d"]), TODAY);
    expect(all.map((g) => g.gate)).toEqual(["A", "B", "C"]);
    expect(all[0]!.stats).toMatchObject({ n: 4 - 1, median: 5 });
    expect(all[0]!.open).toEqual([{ itemId: "d", days: 10 }]);
    expect(all[0]!.outcomes).toEqual({ go: 2, go_with_conditions: 0, hold: 1, stop: 0 });
    expect(all[1]!.outcomes.stop).toBe(1);
    expect(all[2]!.stats).toBeNull();
  });
  it("a withdrawn request is not waiting", () => {
    const w = { ...req("a", "A", 0, null), withdrawn_at: `${iso(5)}T00:00:00Z` };
    expect(decisionStats([w], new Set(["a"]), TODAY)[0]!.open).toEqual([]);
  });
});

describe("sub-phases", () => {
  const f = full("a");
  const vr = (extra: Record<string, unknown> = {}, skip = false) => velocityRows([{ ...f.row, ...extra, ...(skip ? { start_beta: undefined, start_experiment: undefined } : {}) }], f.requests, total, TODAY)[0]!;
  it("Build, Test and Experiment take the dates of the phases", () => {
    expect([subPhaseDays(vr(), "build", TODAY), subPhaseDays(vr(), "test", TODAY), subPhaseDays(vr(), "experiment", TODAY)]).toEqual([35, 10, 20]);
  });
  it("Build is the tracker's Actual Build when there is one", () => {
    expect(subPhaseDays(vr({ time_building_days: 30, actual_build_weeks: 4.3 }), "build", TODAY)).toBe(30);
  });
  it("a skipped phase is not counted (never zero) and one that has not ended yet is not counted", () => {
    expect(subPhaseDays(vr({}, true), "test", TODAY)).toBeNull();
    expect(subPhaseDays(vr({}, true), "experiment", TODAY)).toBeNull();
    expect(subPhaseDays(vr(), "build", D0 + 60)).toBeNull();
  });
  it("stats per phase and the median by size need 3 in a cell", () => {
    const rows = [1, 2, 3].map((i) => full(`s${i}`, { effort: "S" }, i));
    const v = velocityRows(rows.map((r) => r.row), rows.flatMap((r) => r.requests), total, TODAY);
    expect(subPhaseStats(v, TODAY).map((s) => [s.id, s.stats!.median])).toEqual([["build", 35], ["test", 10], ["experiment", 20]]);
    const bySize = subPhaseBySize(v, TODAY);
    expect(bySize.find((r) => r.size === "S")!.cells.build).toEqual({ n: 3, median: 35 });
    expect(bySize.find((r) => r.size === "XL")!.cells.build).toEqual({ n: 0, median: null });
  });
});

describe("in flight and already slower than usual", () => {
  const finished = [10, 11, 12, 13, 14, 15].map((i) => row(`f${i}`, { start: 0, roll: i * 10 }, { effort: "M" }));
  it("lists started initiatives that are past the P80 of finished ones of their size, with the stage they are in", () => {
    const slow = row("slow", { start: 0, def: 20, build: 150 }, { effort: "M" }); // elapsed 400 days: well past P80
    const fine = row("fine", { start: 340, def: 350 }, { effort: "M" }); // elapsed 60
    const cancelled = row("x", { start: 0 }, { effort: "M", initiative_status: "Cancelled" });
    const completed = row("y", { start: 0 }, { effort: "M", initiative_status: "Completed" });
    const none = row("z", {}, { effort: "M" });
    const out = inFlightSlow([...finished, slow, fine, cancelled, completed, none], [], total, TODAY);
    expect(out.map((o) => o.id)).toEqual(["slow"]);
    expect(out[0]).toMatchObject({ elapsed: 400, stage: "build", daysInStage: 400 - 150 });
    expect(out[0]!.over).toBeGreaterThan(0);
  });
  it("uses all sizes together for a size with fewer than 5 finished", () => {
    const l = row("big", { start: 0 }, { effort: "L" });
    expect(inFlightSlow([...finished, l], [], total, TODAY).map((o) => o.id)).toEqual(["big"]);
  });
  it("follows the measure: for Build it compares the build so far with finished builds", () => {
    const built = [10, 12, 14, 16, 18, 20].map((w) => ({ ...row(`b${w}`, { build: 0 }, { effort: "M" }), time_building_days: w * 7, actual_build_weeks: w }));
    const running = row("running", { build: 300 }, { effort: "M" }); // 100 days into its build, finished ones took 70 to 140
    const slowBuild = row("slowbuild", { build: 150 }, { effort: "M" }); // 250 days into its build
    const out = inFlightSlow([...built, running, slowBuild], [], { measure: "build", stretch: false }, TODAY);
    expect(out.map((o) => o.id)).toEqual(["slowbuild"]);
    expect(out[0]).toMatchObject({ elapsed: 250, stage: "build", daysInStage: 250 });
  });
  it("is empty when fewer than 5 have finished to compare with, for any size", () => {
    expect(inFlightSlow([row("a", { start: 0, roll: 50 }), row("b", { start: 0, roll: 60 }), row("c", { start: 0 })], [], total, TODAY)).toEqual([]);
  });
  it("is empty when nothing has finished to compare with", () => {
    expect(inFlightSlow([row("a", { start: 0 })], [], total, TODAY)).toEqual([]);
  });
});

describe("rows are not changed", () => {
  it("returns the row it was given", () => {
    const r = full("a").row;
    const v: VelocityRow = velocityRows([r], [], total, TODAY)[0]!;
    expect(v.row).toBe(r);
  });
});
