import { describe, expect, it } from "vitest";
import { lifecycleSegments, phaseDurations, timeToMarket, ttmBy, ttmSummary } from "./time-to-market";
import type { ReportRow } from "./reports";

const row = (o: Record<string, unknown>): ReportRow => ({ id: String(o.id ?? "x"), ...o }) as ReportRow;

describe("Time to Market (issue #233, section 5.2)", () => {
  it("counts from the earlier of Start Discovery and Start Date: 3 March / 10 March to 3 June is 92 days", () => {
    expect(timeToMarket(row({ start_discovery: "2027-03-03", start_date: "2027-03-10", g2m_date_actual: "2027-06-03" }))?.days).toBe(92);
  });
  it("uses Start Date when it is earlier (1 March gives 94) or when Start Discovery is empty", () => {
    expect(timeToMarket(row({ start_discovery: "2027-03-03", start_date: "2027-03-01", g2m_date_actual: "2027-06-03" }))?.days).toBe(94);
    expect(timeToMarket(row({ start_date: "2027-03-03", g2m_date_actual: "2027-06-03" }))?.days).toBe(92);
  });
  it("excludes rows with no G2M Date (actual), no start, or an end before the start", () => {
    expect(timeToMarket(row({ start_discovery: "2027-03-03" }))).toBeNull();
    expect(timeToMarket(row({ g2m_date_actual: "2027-06-03" }))).toBeNull();
    expect(timeToMarket(row({ start_date: "2027-07-01", g2m_date_actual: "2027-06-03" }))).toBeNull();
  });
  it("summarises median, average and how many were left out", () => {
    const rows = [
      row({ id: "a", start_date: "2027-01-01", g2m_date_actual: "2027-01-11" }), // 10
      row({ id: "b", start_date: "2027-01-01", g2m_date_actual: "2027-01-31" }), // 30
      row({ id: "c", start_date: "2027-01-01", g2m_date_actual: "2027-02-20" }), // 50
      row({ id: "d", start_date: "2027-01-01", g2m_date_actual: "2027-01-21" }), // 20
      row({ id: "e", start_date: "2027-01-01" }),
    ];
    const s = ttmSummary(rows);
    expect(s).toMatchObject({ count: 4, excluded: 1, median: 25, average: 27.5 });
    expect(ttmSummary([])).toMatchObject({ count: 0, excluded: 0, median: null, average: null });
  });
  it("groups by effort and counts a multi-team initiative once per team", () => {
    const rows = [
      row({ id: "a", effort: "S", contributing_teams: "Core, Mobile", start_date: "2027-01-01", g2m_date_actual: "2027-01-11" }),
      row({ id: "b", effort: "S", contributing_teams: "Core", start_date: "2027-01-01", g2m_date_actual: "2027-01-31" }),
    ];
    expect(ttmBy(rows, "effort").map((g) => [g.key, g.count, g.median])).toEqual([["S", 2, 20]]);
    const t = ttmBy(rows, "team", { teamNames: ["Core", "Mobile"] });
    expect(t.map((g) => [g.key, g.count, g.median])).toEqual([["Core", 2, 20], ["Mobile", 1, 10]]);
  });
});

describe("phase durations", () => {
  it("each phase runs to the next start, the last to G2M Date (actual); only completed initiatives count", () => {
    const rows = [row({ id: "a", start_discovery: "2027-01-01", start_definition: "2027-01-11", start_building: "2027-02-10", g2m_date_actual: "2027-03-12" }), row({ id: "b", start_discovery: "2027-01-01" })];
    expect(phaseDurations(rows)).toEqual([{ phase: "Discover", count: 1, average: 10, median: 10 }, { phase: "Define", count: 1, average: 30, median: 30 }, { phase: "Build", count: 1, average: 30, median: 30 }]);
  });
});

describe("lifecycle segments for the timeline", () => {
  const today = new Date(Date.UTC(2027, 3, 14));
  it("one segment per phase start, ending at the next start and at G2M Date (actual)", () => {
    const s = lifecycleSegments(row({ initiative_phase: "Build", start_discovery: "2027-01-01", start_definition: "2027-01-11", start_building: "2027-02-10", g2m_date_actual: "2027-03-12" }), today)!;
    expect(s.map((x) => [x.phase, x.start, x.end])).toEqual([["Discover", "2027-01-01", "2027-01-11"], ["Define", "2027-01-11", "2027-02-10"], ["Build", "2027-02-10", "2027-03-12"]]);
  });
  it("an open lifecycle runs to the G2M date (est), else to today", () => {
    expect(lifecycleSegments(row({ initiative_phase: "Define", start_definition: "2027-03-01", g2m_date_est: "2027-06-30" }), today)![0]).toMatchObject({ end: "2027-06-30" });
    expect(lifecycleSegments(row({ initiative_phase: "Define", start_definition: "2027-03-01" }), today)![0]).toMatchObject({ end: "2027-04-14" });
  });
  it("with no phase dates it falls back to Planned Start to G2M Date (est) in the current phase; nothing at all gives null", () => {
    expect(lifecycleSegments(row({ initiative_phase: "Build", planned_start: "2027-02-01", g2m_date_est: "2027-05-01" }), today)).toEqual([{ phase: "Build", start: "2027-02-01", end: "2027-05-01" }]);
    expect(lifecycleSegments(row({ initiative_phase: "Build" }), today)).toBeNull();
  });
});
