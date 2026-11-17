import { describe, expect, it } from "vitest";
import { buildTimeBy, buildTimeOf, buildTimeSummary, buildVsEstimate } from "./build-time";
import { phaseDurations } from "./time-to-market";

const row = (id: string, o: Record<string, unknown> = {}) => ({ id, ...o });
const built = (id: string, days: number, o: Record<string, unknown> = {}) => row(id, { start_building: "2026-11-02", time_building_days: days, actual_build_weeks: Math.round((days / 7) * 10) / 10, ...o });

describe("buildTimeOf", () => {
  it("is the computed Actual Build, with the end worked out from Start Building and the days", () => {
    expect(buildTimeOf(built("a", 21))).toEqual({ id: "a", weeks: 3, days: 21, start: "2026-11-02", end: "2026-11-23" });
  });
  it("reads the numbers when the database gives them as text, and gives nothing without a start, an end or a sensible number", () => {
    expect(buildTimeOf(row("a", { start_building: "2026-11-02", time_building_days: "10", actual_build_weeks: "1.4" }))).toMatchObject({ weeks: 1.4, days: 10 });
    expect(buildTimeOf(row("a", { time_building_days: 10, actual_build_weeks: 1.4 }))).toBeNull(); // no Start Building
    expect(buildTimeOf(row("a", { start_building: "2026-11-02" }))).toBeNull(); // no end yet
    expect(buildTimeOf(built("a", -3))).toBeNull();
    expect(buildTimeOf(row("a", { start_building: "2026-11-02", time_building_days: "x", actual_build_weeks: null }))).toBeNull();
  });
});

describe("buildTimeSummary", () => {
  const rows = [built("a", 14), built("b", 21), built("c", 35), row("d", { start_building: "2026-11-02" }), row("e"), row("f", { start_building: "2026-11-02", time_building_days: null })];
  it("counts the initiatives with a build time, median and average in weeks, and those still building apart; never as zero", () => {
    const s = buildTimeSummary(rows);
    expect(s).toMatchObject({ count: 3, stillBuilding: 2, median: 3, average: (2 + 3 + 5) / 3 });
    expect(s.points.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("has no median for no data", () => {
    expect(buildTimeSummary([])).toMatchObject({ count: 0, stillBuilding: 0, median: null, average: null });
  });
});

describe("buildTimeBy", () => {
  it("per Team and Effort, the medians of the weeks; an initiative with two teams counts once for each; not set last", () => {
    const rows = [built("a", 14, { contributing_teams: "Core", effort: "M" }), built("b", 28, { contributing_teams: "Core, Mobile", effort: "M" }), built("c", 7, { effort: "S" })];
    expect(buildTimeBy(rows, "team").map((g) => [g.key, g.count, g.median])).toEqual([["Core", 2, 3], ["Mobile", 1, 4], ["__none", 1, 1]]);
    expect(buildTimeBy(rows, "effort").map((g) => [g.key, g.count, g.median])).toEqual([["M", 2, 3], ["S", 1, 1]]);
  });
});

describe("buildVsEstimate", () => {
  it("of the initiatives with both a build time and an estimate: how many took longer, and the median share of the high estimate", () => {
    const rows = [built("a", 14, { build_vs_estimate_high_pct: 67 }), built("b", 21, { build_vs_estimate_high_pct: 150 }), built("c", 28, { build_vs_estimate_high_pct: 100 }), built("d", 7), row("e", { build_vs_estimate_high_pct: 80 })];
    expect(buildVsEstimate(rows)).toEqual({ count: 3, median: 100, over: 1, within: 2 });
  });
});

describe("days in each phase: the Build phase is the build time", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10);
  it("uses the tracker-based build days for Build, and the next phase start when there are none", () => {
    const tracker = row("a", { start_building: day(0), start_beta: day(30), g2m_date_actual: day(40), time_building_days: 10 });
    const fallback = row("b", { start_building: day(0), start_beta: day(30), g2m_date_actual: day(40) });
    expect(phaseDurations([tracker]).find((p) => p.phase === "Build")).toMatchObject({ count: 1, median: 10 });
    expect(phaseDurations([fallback]).find((p) => p.phase === "Build")).toMatchObject({ count: 1, median: 30 });
    expect(phaseDurations([tracker]).find((p) => p.phase === "Test")).toMatchObject({ median: 10 }); // the other phases are unchanged
  });
});
