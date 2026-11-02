import { describe, expect, it } from "vitest";
import { ageDays, agingSummary, dayNumber, daysInPhase, healthCounts, longestInPhase } from "./roadmap-health";
import type { ReportRow } from "./reports";

const row = (o: Record<string, unknown>): ReportRow => ({ id: String(o.id ?? "x"), initiative_status: "Active", ...o }) as ReportRow;
const TODAY = dayNumber(new Date("2027-03-31T10:00:00Z"));

describe("Roadmap Health (request R-129)", () => {
  it("days in phase counts from the start of the current phase; the 1 March start of Build gives 30", () => {
    expect(daysInPhase(row({ initiative_phase: "Build", start_building: "2027-03-01", start_discovery: "2027-01-01" }), TODAY)).toBe(30);
  });
  it("falls back to Phase Changed At, and is null with no date or a date in the future", () => {
    expect(daysInPhase(row({ initiative_phase: "Define", phase_changed_at: "2027-03-21T08:00:00Z" }), TODAY)).toBe(10);
    expect(daysInPhase(row({ initiative_phase: "Define" }), TODAY)).toBeNull();
    expect(daysInPhase(row({ initiative_phase: "Build", start_building: "2027-04-02" }), TODAY)).toBeNull();
  });
  it("age counts from Start Date, else Planned Start", () => {
    expect(ageDays(row({ start_date: "2027-03-01", planned_start: "2027-02-01" }), TODAY)).toBe(30);
    expect(ageDays(row({ planned_start: "2027-03-21" }), TODAY)).toBe(10);
    expect(ageDays(row({}), TODAY)).toBeNull();
  });
  it("counts only active initiatives and keeps Blocked, At Risk and Delayed apart", () => {
    const c = healthCounts([
      row({ health: "Blocked" }), row({ health: "At Risk" }), row({ health: "At Risk" }), row({ health: "Delayed" }), row({ health: "On Track" }),
      row({ health: "Blocked", initiative_status: "On hold" }), row({ initiative_status: "Completed" }),
    ]);
    expect(c).toEqual({ active: 5, counts: { Blocked: 1, "At Risk": 2, Delayed: 1 }, needAttention: 4 });
  });
  it("summarises aging per phase in lifecycle order and counts rows without a date instead of dropping them", () => {
    const rows = [
      row({ id: "a", initiative_phase: "Build", start_building: "2027-03-01" }), // 30
      row({ id: "b", initiative_phase: "Build", start_building: "2027-02-01" }), // 58
      row({ id: "c", initiative_phase: "Build" }), // no date
      row({ id: "d", initiative_phase: "Discover", start_discovery: "2027-03-21" }), // 10
      row({ id: "e", initiative_phase: "Build", start_building: "2027-01-01", initiative_status: "Cancelled" }), // not active
    ];
    const s = agingSummary(rows, TODAY);
    expect(s.active).toBe(4);
    expect(s.missing).toBe(1);
    expect(s.withDate).toBe(3);
    expect(s.median).toBe(30);
    expect(s.phases.map((p) => p.phase)).toEqual(["Discover", "Build"]);
    expect(s.phases[1]).toMatchObject({ count: 3, withDate: 2, missing: 1, median: 44, max: 58 });
    expect(longestInPhase(rows, TODAY, 2)).toEqual([{ id: "b", days: 58 }, { id: "a", days: 30 }]);
  });
  it("handles 1,000 initiatives well inside a frame (FR-1.11)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({ id: `r${i}`, initiative_phase: "Build", start_building: "2027-01-01", health: i % 5 ? "On Track" : "Blocked" }));
    const t = performance.now();
    agingSummary(rows, TODAY); healthCounts(rows); longestInPhase(rows, TODAY);
    expect(performance.now() - t).toBeLessThan(100);
  });
});
