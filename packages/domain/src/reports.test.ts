import { describe, expect, it } from "vitest";
import { UNSET, drillOn, emptyReport, matchesReport, parseReport, serializeReport, stackCounts, toggleDrill, valuesOf, type ReportRow } from "./reports";

const row = (o: Partial<ReportRow> & Record<string, unknown>): ReportRow => ({ id: o.id ?? "x", archived: false, ...o }) as ReportRow;
const ctx = { teamNames: ["Growth", "Platform", "Data"] };

const rows = [
  row({ id: "1", product_manager: "u1", initiative_phase: "Build", contributing_teams: "Growth, Platform", g2m_quarter: "Q3 2027", effort: "M", theme: "Revenue", initiative_status: "In Progress", health: "At Risk" }),
  row({ id: "2", product_manager: "u1", initiative_phase: "Define", contributing_teams: "Growth", g2m_quarter: "Q4 2027", effort: "S", theme: "Revenue", initiative_status: "Not Started", health: "On Track" }),
  row({ id: "3", product_manager: "u2", initiative_phase: "Build", contributing_teams: "", g2m_quarter: null, effort: "XL", theme: null, initiative_status: "In Progress", health: "Blocked" }),
  row({ id: "4", product_manager: null, initiative_phase: "Discover", archived: true, ai_draft: true }),
];
const ids = (state = emptyReport()) => rows.filter((r) => matchesReport(r, state, ctx)).map((r) => r.id);

describe("report filters", () => {
  it("hides archived by default and shows them with the toggle", () => {
    expect(ids()).toEqual(["1", "2", "3"]);
    expect(ids({ ...emptyReport(), archived: true })).toEqual(["1", "2", "3", "4"]);
  });
  it("includes AI drafts unless switched off", () => {
    const on = { ...emptyReport(), archived: true };
    expect(ids({ ...on, aiDrafts: false })).toEqual(["1", "2", "3"]);
  });
  it("ORs values inside a filter and ANDs filters", () => {
    expect(ids({ ...emptyReport(), filters: { initiative_phase: ["Build", "Define"] } })).toEqual(["1", "2", "3"]);
    expect(ids({ ...emptyReport(), filters: { initiative_phase: ["Build", "Define"], product_manager: ["u1"] } })).toEqual(["1", "2"]);
  });
  it("Team and Quarter: multi-team items match either team; no quarter is Unscheduled only", () => {
    expect(ids({ ...emptyReport(), filters: { team: ["Platform"] } })).toEqual(["1"]);
    expect(ids({ ...emptyReport(), filters: { team: ["Growth"] } })).toEqual(["1", "2"]);
    expect(ids({ ...emptyReport(), filters: { quarter: ["Q3 2027"] } })).toEqual(["1"]);
    expect(ids({ ...emptyReport(), filters: { quarter: [UNSET] } })).toEqual(["3"]);
  });
  it("a drill-down on top of the bar narrows further and a second value on one dimension widens it", () => {
    const s = toggleDrill(emptyReport(), "initiative_phase", "Build");
    expect(ids(s)).toEqual(["1", "3"]);
    expect(ids(toggleDrill(s, "product_manager", "u1"))).toEqual(["1"]);
    expect(ids(toggleDrill(s, "initiative_phase", "Define"))).toEqual(["1", "2", "3"]);
  });
  it("clicking the same element again removes the pill", () => {
    const s = toggleDrill(toggleDrill(emptyReport(), "health", "Blocked"), "health", "Blocked");
    expect(s.drill).toEqual([]);
    expect(drillOn(toggleDrill(emptyReport(), "health", "Blocked"), "health", "Blocked")).toBe(true);
  });
});

describe("valuesOf", () => {
  it("splits teams, drops unknown names, and uses UNSET for empty", () => {
    expect(valuesOf(rows[0]!, "team", ctx)).toEqual(["Growth", "Platform"]);
    expect(valuesOf(rows[2]!, "team", ctx)).toEqual([UNSET]);
    expect(valuesOf(rows[2]!, "group", ctx)).toEqual([UNSET]);
  });
});

describe("stackCounts", () => {
  it("counts phases per Product Manager, largest first, columns in phase order", () => {
    const s = stackCounts(rows.filter((r) => !r.archived), "product_manager", "initiative_phase", ctx);
    expect(s.columns).toEqual(["Define", "Build"]);
    expect(s.rows.map((r) => [r.key, r.total, r.cells])).toEqual([["u1", 2, { Build: 1, Define: 1 }], ["u2", 1, { Build: 1 }]]);
  });
  it("counts a multi-team initiative once per team", () => {
    const s = stackCounts(rows.filter((r) => !r.archived), "team", "initiative_status", ctx);
    const growth = s.rows.find((r) => r.key === "Growth")!;
    const platform = s.rows.find((r) => r.key === "Platform")!;
    expect(growth.total).toBe(2);
    expect(platform.total).toBe(1);
    expect(s.rows.reduce((n, r) => n + r.total, 0)).toBe(4); // 3 items, one counted twice
  });
});

describe("address", () => {
  it("round-trips filters, drill-down and toggles", () => {
    const s = toggleDrill({ ...emptyReport(), archived: true, aiDrafts: false, filters: { team: ["Growth", "Data"], quarter: ["Q3 2027", UNSET] } }, "initiative_phase", "Build");
    const back = parseReport(new URLSearchParams(serializeReport(s).toString()));
    expect(back).toEqual(s);
  });
  it("ignores unknown fields and junk", () => {
    const p = new URLSearchParams("f.nope=1&d=bad&d=health:Blocked&arch=maybe");
    expect(parseReport(p)).toEqual({ ...emptyReport(), drill: [{ dim: "health", value: "Blocked" }] });
  });
  it("an untouched state has an empty address", () => {
    expect(serializeReport(emptyReport()).toString()).toBe("");
  });
});
