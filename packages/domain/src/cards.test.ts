import { describe, expect, it } from "vitest";
import { FIELD_BY_KEY } from "./registry";
import { axisOptions, axisValues, boardMoves, buildBoard, cardNeighbor, defaultColumnField, planMove, type AxisCtx } from "./cards";

const ctx: AxisCtx = {
  groups: ["Onboarding", "Retention"],
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
  teams: ["Core", "Mobile"],
  teamsOf: (r) => (typeof r.contributing_teams === "string" ? r.contributing_teams.split(", ").filter(Boolean) : []),
};
const row = (id: string, rank: number, extra: Record<string, unknown> = {}) => ({ id, stack_rank: rank, item_code: id.toUpperCase(), initiative_name: `Item ${id}`, ...extra });

describe("axisOptions: what can be a column or a swimlane", () => {
  const o = axisOptions();
  it("offers the select fields people edit, Initiative Group, project and team, and shows the locked GitHub status as read-only", () => {
    const keys = o.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["initiative_phase", "roadmap_category", "moscow", "health", "horizon", "focus_area", "decision", "effort", "theme", "home_project", "team", "status"]));
    expect(o.find((x) => x.key === "status")).toMatchObject({ editable: false, reason: expect.stringContaining("comes from GitHub") });
    expect(o.find((x) => x.key === "moscow")).toMatchObject({ editable: true });
    expect(o.find((x) => x.key === "team")).toMatchObject({ editable: false, reason: expect.stringContaining("several teams") });
  });
  it("offers Planning Status, and nothing system-set", () => {
    expect(o.find((x) => x.key === "planning_status")).toMatchObject({ available: true, label: "Planning Status", editable: true });
    expect(o.find((x) => x.key === "created_via")).toBeUndefined();
    expect(o.find((x) => x.key === "current_gate")).toBeUndefined();
  });
  it("the default column is Initiative Phase", () => {
    expect(defaultColumnField()).toBe("initiative_phase");
  });
});

describe("axisValues: the columns or lanes of a field, in order", () => {
  it("a select field uses the dictionary's values in order", () => {
    expect(axisValues("moscow", ctx).map((v) => v.label)).toEqual(["Must", "Should", "Could", "Won't"]);
  });
  it("Initiative Group uses the workspace's groups, project and team their names", () => {
    expect(axisValues("theme", ctx)).toEqual([{ value: "Onboarding", label: "Onboarding" }, { value: "Retention", label: "Retention" }]);
    expect(axisValues("home_project", ctx)).toEqual([{ value: "p2", label: "Marketplace" }, { value: "p1", label: "Platform" }]);
    expect(axisValues("team", ctx).map((v) => v.label)).toEqual(["Core", "Mobile"]);
  });
});

describe("buildBoard", () => {
  const rows = [
    row("a1", 1, { moscow: "Must", theme: "Onboarding" }),
    row("a2", 2, { moscow: "Should", theme: "Onboarding" }),
    row("a3", 3, { moscow: "Must", theme: "Retention" }),
    row("a4", 4, { moscow: null, theme: null }),
    row("a5", 5, { moscow: "Must", theme: "Onboarding" }),
  ];
  const b = buildBoard(rows, "moscow", "theme", ctx);
  it("columns are the field's values plus 'No value'; lanes the groups present plus 'No value'", () => {
    expect(b.columns.map((c) => c.label)).toEqual(["Must", "Should", "Could", "Won't", "No value"]);
    expect(b.lanes.map((l) => l.label)).toEqual(["Onboarding", "Retention", "No value"]);
  });
  it("puts cards in their cell by global rank, with counts per column and per lane", () => {
    const l = b.lanes[0]!;
    expect(l.cells.get("Must")).toEqual(["a1", "a5"]);
    expect(l.cells.get("Should")).toEqual(["a2"]);
    expect(l.count).toBe(3);
    expect(b.lanes[2]!.cells.get("")).toEqual(["a4"]);
    expect(b.columnCounts.get("Must")).toBe(3);
    expect(b.columnCounts.get("")).toBe(1);
    expect(b.total).toBe(5);
  });
  it("a card with a value that is not in the list still shows, in its own column", () => {
    const odd = buildBoard([row("x", 1, { moscow: "Maybe" })], "moscow", null, ctx);
    expect(odd.columns.map((c) => c.value)).toContain("Maybe");
    expect(odd.lanes).toHaveLength(1);
    expect(odd.lanes[0]!.cells.get("Maybe")).toEqual(["x"]);
  });
  it("with no swimlane there is a single lane; empty select lanes are listed so a card can be dropped there", () => {
    const flat = buildBoard(rows, "moscow", null, ctx);
    expect(flat.lanes).toHaveLength(1);
    const byHorizon = buildBoard(rows, "moscow", "horizon", ctx);
    expect(byHorizon.lanes.map((l) => l.label)).toEqual(["Now", "Next", "Later", "No value"]);
    expect(byHorizon.lanes.find((l) => l.label === "Now")!.count).toBe(0);
  });
  it("an open list (Focus Area) has no fixed lanes: the lanes are the values in use, then No value (issue #246)", () => {
    const some = [row("a", 1, { moscow: "Must", focus_area: "Pricing" }), row("b", 2, { moscow: "Must", focus_area: "Loyalty" }), row("c", 3, { moscow: "Must" })];
    const lanes = buildBoard(some, "moscow", "focus_area", ctx).lanes;
    expect(lanes.map((l) => l.label)).toEqual(["Loyalty", "Pricing", "No value"]);
    expect(lanes.find((l) => l.label === "Pricing")!.count).toBe(1);
  });
  it("team lanes list a card under each of its teams", () => {
    const t = buildBoard([row("a", 1, { moscow: "Must", contributing_teams: "Core, Mobile" }), row("b", 2, { moscow: "Must" })], "moscow", "team", ctx);
    expect(t.lanes.map((l) => [l.label, l.count])).toEqual([["Core", 1], ["Mobile", 1], ["No value", 1]]);
  });
});

describe("planMove: what dropping a card on a cell changes", () => {
  const r = row("a1", 1, { moscow: "Must", theme: "Onboarding" });
  it("changes the column field when the column differs and the lane field when the lane differs", () => {
    expect(planMove(r, { colField: "moscow", laneField: "theme", toCol: "Should", toLane: "Retention" })).toEqual({ ok: true, changes: { moscow: "Should", theme: "Retention" } });
    expect(planMove(r, { colField: "moscow", laneField: "theme", toCol: "Should", toLane: "Onboarding" })).toEqual({ ok: true, changes: { moscow: "Should" } });
    expect(planMove(r, { colField: "moscow", laneField: "theme", toCol: "Must", toLane: "Onboarding" })).toEqual({ ok: true, changes: {} });
  });
  it("'No value' clears a field that may be empty and is refused for one that may not", () => {
    expect(planMove(r, { colField: "moscow", laneField: null, toCol: "", toLane: "" })).toEqual({ ok: true, changes: { moscow: null } });
    const home = row("a2", 2, { home_project: "p1" });
    expect(planMove(home, { colField: "home_project", laneField: null, toCol: "", toLane: "" })).toEqual({ ok: false, error: "Project cannot be empty." });
  });
  it("refuses to cross a read-only axis and says why (Initiative Status comes from GitHub)", () => {
    const s = row("a3", 3, { status: "Backlog", moscow: "Must" });
    const res = planMove(s, { colField: "status", laneField: "moscow", toCol: "In Progress", toLane: "Must" });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("comes from GitHub") });
    expect(planMove(s, { colField: "status", laneField: "moscow", toCol: "Backlog", toLane: "Should" })).toEqual({ ok: true, changes: { moscow: "Should" } }); // only the lane changes
  });
  it("a team lane cannot be dropped on", () => {
    expect(planMove(r, { colField: "moscow", laneField: "team", toCol: "Must", toLane: "Core" })).toMatchObject({ ok: false, error: expect.stringContaining("several teams") });
  });
});

describe("cardNeighbor and boardMoves: the keyboard way to move a card", () => {
  const rows = [row("a1", 1, { moscow: "Must", theme: "Onboarding" })];
  const b = buildBoard(rows, "moscow", "theme", ctx);
  it("Shift+arrow targets the next or previous column, or lane, and stops at the ends", () => {
    expect(cardNeighbor(b, "Must", "Onboarding", "right")).toEqual({ col: "Should", lane: "Onboarding" });
    expect(cardNeighbor(b, "Must", "Onboarding", "left")).toBeNull();
    expect(cardNeighbor(b, "Must", "Onboarding", "down")).toEqual({ col: "Must", lane: "Retention" });
    expect(cardNeighbor(b, "Must", "Onboarding", "up")).toBeNull();
    expect(cardNeighbor(b, "", "", "right")).toBeNull();
  });
  it("lists every cell a card can be moved to for the Move menu", () => {
    const m = boardMoves(b);
    expect(m.columns.map((c) => c.label)).toEqual(["Must", "Should", "Could", "Won't", "No value"]);
    expect(m.lanes.map((c) => c.label)).toEqual(["Onboarding", "Retention", "No value"]);
  });
  it("knows the field metadata it relies on", () => {
    expect(FIELD_BY_KEY.moscow!.allowed).toHaveLength(4);
  });
});
