import { describe, expect, it } from "vitest";
import { computeInsights, quarterKey, type InsightRow } from "./insights";

const row = (o: Record<string, unknown>): InsightRow => ({ home_project: "p1", initiative_status: "Active", health: "On Track", initiative_phase: "Build", g2m_quarter: "Q1 2027", ...o });
const name = (id: string) => ({ p1: "Platform", p2: "Growth" })[id] ?? "";

describe("computeInsights", () => {
  const rows = [
    row({}), row({ health: "At Risk" }), row({ health: "Blocked", initiative_phase: "Define", g2m_quarter: "Q4 2026" }),
    row({ health: null, initiative_phase: "Discover", g2m_quarter: null, gate_status: "In review" }),
    row({ initiative_status: "Completed", health: "Blocked" }), row({ initiative_status: "Backlog" }),
  ];
  const i = computeInsights(rows, name);
  it("counts only active initiatives", () => { expect(i.active).toBe(4); expect(i.needAttention).toBe(2); expect(i.waitingForDecision).toBe(1); });
  it("health keeps its order and names a missing health", () => expect(i.health.map((h) => [h.label, h.count])).toEqual([["On Track", 1], ["At Risk", 1], ["Blocked", 1], ["No health", 1]]));
  it("phases follow the lifecycle order and drop Completed", () => {
    expect(i.phases.map((p) => p.label)).toEqual(["Discover", "Define", "Build", "Test", "Experiment", "Roll-out"]);
    expect(i.phases.find((p) => p.label === "Build")!.count).toBe(2);
  });
  it("quarters run in time order with no quarter last", () => expect(i.quarters.map((q) => q.label)).toEqual(["Q4 2026", "Q1 2027", "No quarter"]));
  it("says it in words", () => {
    expect(i.summary.health).toBe("2 of 4 active initiatives need attention: 1 At Risk, 1 Blocked.");
    expect(i.summary.phases).toBe("Most active work is in Build: 2 of 4 (50%).");
    expect(i.summary.quarters).toContain("Q4 2026 is the nearest planned quarter with 1 initiative.");
    expect(i.summary.quarters).toContain("1 have no planned quarter.");
  });
  it("does not name one phase when several tie", () => {
    const t = computeInsights([row({ initiative_phase: "Define" }), row({ initiative_phase: "Build" }), row({ initiative_phase: "Test" })], name);
    expect(t.summary.phases).toBe("The most active work is shared by Define, Build and Test: 1 each, of 3.");
  });
  it("averages build progress per project and leaves out what the tracker has not said", () => {
    const b = computeInsights([row({ delivery_progress_pct: 40 }), row({ delivery_progress_pct: 60 }), row({ home_project: "p2", delivery_progress_pct: null })], name).build;
    expect(b).toEqual([{ label: "Platform", count: 2, value: 50 }, { label: "Growth", count: 1, value: null }]);
  });
  it("copes with nothing", () => {
    const e = computeInsights([], name);
    expect(e.active).toBe(0);
    expect(e.summary.health).toBe("There are no active initiatives.");
    expect(e.phases.every((p) => p.pct === 0)).toBe(true);
  });
});

describe("quarterKey", () => { it("orders by year then quarter", () => expect([quarterKey("Q1 2027"), quarterKey("Q4 2026"), quarterKey("soon")].sort((a, b) => a - b)).toEqual([quarterKey("Q4 2026"), quarterKey("Q1 2027"), quarterKey("soon")])); });
