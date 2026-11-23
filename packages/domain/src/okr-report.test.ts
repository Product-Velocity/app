import { describe, expect, it } from "vitest";
import { currentQuarter, inQuarter, objectiveByQuarter, okrByBusinessLine } from "./okr-report";
import { UNSET, type ReportRow } from "./reports";

const row = (o: Record<string, unknown>): ReportRow => ({ id: String(o.id ?? Math.random()), ...o }) as ReportRow;

describe("OKRs report", () => {
  const rows = [
    row({ business_line: "Programmatic", okr_objective: "Every pageview earns more", g2m_quarter: "Q4 2026", initiative_phase: "Build", focus_area: "Yield", sponsor: "Paula", value_type: "Grow existing revenue" }),
    row({ business_line: "Programmatic", okr_objective: "Every pageview earns more", g2m_quarter: "Q1 2027", initiative_phase: "Define", focus_area: "Yield", sponsor: "Paula" }),
    row({ business_line: "Programmatic", okr_objective: "Every pageview earns more", g2m_quarter: "Q4 2026", initiative_phase: "Test", focus_area: "SSP Demand" }),
    row({ business_line: "Programmatic", okr_objective: "More publishers monetise through us", g2m_quarter: "Q4 2026" }),
    row({ business_line: "Direct", okr_objective: "More advertisers choose us" }),
    row({ okr_objective: "Orphan objective" }),
    row({}),
  ];

  it("groups objectives under their business line with counts, largest first and Not set last", () => {
    const g = okrByBusinessLine(rows);
    expect(g.map((x) => [x.key, x.total])).toEqual([["Programmatic", 4], ["Direct", 1], [UNSET, 2]]);
    expect(g[0]!.objectives.map((o) => [o.key, o.count])).toEqual([["Every pageview earns more", 3], ["More publishers monetise through us", 1]]);
    expect(g[2]!.objectives.map((o) => [o.key, o.count])).toEqual([["Orphan objective", 1], [UNSET, 1]]);
  });
  it("lists the focus areas, owners and value types seen on an objective, most used first", () => {
    const o = okrByBusinessLine(rows)[0]!.objectives[0]!;
    expect(o.focusAreas).toEqual(["Yield", "SSP Demand"]);
    expect(o.owners).toEqual(["Paula"]);
    expect(o.valueTypes).toEqual(["Grow existing revenue"]);
  });
  it("never drops an initiative: the counts add up to the rows given", () => {
    expect(okrByBusinessLine(rows).reduce((n, g) => n + g.total, 0)).toBe(rows.length);
  });
  it("puts quarters in time order across years with Unscheduled last", () => {
    const s = objectiveByQuarter(rows);
    expect(s.columns).toEqual(["Q4 2026", "Q1 2027", UNSET]);
    expect(s.rows.find((r) => r.key === "Every pageview earns more")!.cells).toEqual({ "Q4 2026": 2, "Q1 2027": 1 });
  });
  it("finds the quarter of a day and the initiatives planned for it", () => {
    expect(currentQuarter(new Date("2026-11-23T10:00:00Z"))).toBe("Q4 2026");
    expect(currentQuarter(new Date("2027-01-01T00:00:00Z"))).toBe("Q1 2027");
    expect(inQuarter(rows, "Q4 2026")).toHaveLength(3);
  });
});
