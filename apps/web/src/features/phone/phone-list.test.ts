import { describe, expect, it } from "vitest";
import { chipFilters, filterPhoneRows, groupPhoneRows, sortPhoneRows, type PhoneRow } from "./phone-list";

const row = (o: Partial<PhoneRow> & { id: string }): PhoneRow => ({ item_code: o.id, initiative_name: "Thing", stack_rank: 1, home_project: "p1", ...o });
const ctx = { me: "u1", today: new Date("2026-11-09"), project: (id: string) => (id === "p1" ? "Platform" : "Growth"), person: (id: string) => (id === "u1" ? "Dana" : "Lee") };
const rows = [
  row({ id: "R-1", initiative_name: "Self-serve onboarding", stack_rank: 2, initiative_phase: "Build", product_manager: "u1", health: "At Risk", created_at: "2026-11-02T10:00:00Z", g2m_quarter: "2027 Q1" }),
  row({ id: "R-2", initiative_name: "Billing revamp", stack_rank: 1, initiative_phase: "Define", product_manager: "u2", health: "On Track", home_project: "p2", created_at: "2026-11-08T10:00:00Z" }),
  row({ id: "R-3", initiative_name: "Search", stack_rank: 3, initiative_phase: "Test", product_manager: "u2", health: "Blocked", created_at: "2026-10-01T10:00:00Z", g2m_quarter: "2027 Q1" }),
];
const f = (o: { query?: string; chips?: string[] }) => filterPhoneRows(rows, { query: "", chips: [], ...ctx, ...o }).map((r) => r.id);

describe("phone list", () => {
  it("searches code, name, project and owner", () => {
    expect(f({ query: "onboard" })).toEqual(["R-1"]);
    expect(f({ query: "growth" })).toEqual(["R-2"]);
    expect(f({ query: "dana" })).toEqual(["R-1"]);
    expect(f({ query: "r-3" })).toEqual(["R-3"]);
  });
  it("combines chips: phases widen, other chips narrow", () => {
    expect(f({ chips: ["phase-Build", "phase-Test"] })).toEqual(["R-1", "R-3"]);
    expect(f({ chips: ["phase-Build", "phase-Test", "attention"] })).toEqual(["R-1", "R-3"]);
    expect(f({ chips: ["mine", "attention"] })).toEqual(["R-1"]);
    expect(f({ chips: ["phase-Define", "attention"] })).toEqual([]);
  });
  it("ignores unknown chips", () => expect(chipFilters(["nope"])).toEqual({ phases: [], filters: [] }));
  it("sorts by rank or newest", () => {
    expect(sortPhoneRows(rows, "rank").map((r) => r.id)).toEqual(["R-2", "R-1", "R-3"]);
    expect(sortPhoneRows(rows, "newest").map((r) => r.id)).toEqual(["R-2", "R-1", "R-3"]);
  });
  it("groups by phase in lifecycle order, by quarter with the empty one last", () => {
    expect(groupPhoneRows(rows, "phase", ctx.project).map((g) => g.label)).toEqual(["Define", "Build", "Test"]);
    expect(groupPhoneRows(rows, "quarter", ctx.project).map((g) => g.label)).toEqual(["2027 Q1", "No quarter"]);
    expect(groupPhoneRows(rows, "none", ctx.project)).toHaveLength(1);
  });
});
