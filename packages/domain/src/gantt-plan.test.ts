import { describe, expect, it } from "vitest";
import { allGroupIds, classifyRows, fitZoom, layoutLines, moveMany, timelineTicks, toDay, ZOOMS, PX_PER_DAY } from "./gantt";
import { buildDeps, chainOf, gateMarker, parseDeps, planVsActual, rollup } from "./gantt-plan";

const TODAY = new Date(Date.UTC(2027, 3, 14)); // Wed 14 Apr 2027
const row = (id: string, planned_start: string | null, g2m_date_est: string | null, extra: Record<string, unknown> = {}) => ({ id, item_code: id.toUpperCase(), initiative_name: `Item ${id}`, planned_start, g2m_date_est, ...extra });
const barOf = (r: ReturnType<typeof row>) => classifyRows([r]).bars[0]!;

describe("planned against actual (no stored baseline)", () => {
  it("compares the actual start and finish with the plan, in words", () => {
    const r = row("a1", "2027-02-01", "2027-03-01", { start_date: "2027-02-04", g2m_date_actual: "2027-03-10" });
    const p = planVsActual(r, barOf(r), TODAY);
    expect(p.startSlip).toBe(3);
    expect(p.endSlip).toBe(9);
    expect(p.overdue).toBeNull();
    expect(p.ended).toBe(true);
    expect(p.notes).toEqual(["Started 3 days late", "Finished 9 days late"]);
    expect(p.actualLine).toEqual({ startDay: toDay("2027-02-04"), endDay: toDay("2027-03-10"), running: false });
  });
  it("early and on-plan are said too", () => {
    const r = row("a1", "2027-02-01", "2027-03-01", { start_date: "2027-01-31", g2m_date_actual: "2027-03-01" });
    expect(planVsActual(r, barOf(r), TODAY).notes).toEqual(["Started 1 day early", "Finished on plan"]);
  });
  it("overdue: past G2M Date (est), no finish, phase not ended; the actual line runs to today", () => {
    const r = row("a1", "2027-02-01", "2027-04-02", { start_date: "2027-02-01", initiative_phase: "Build" });
    const p = planVsActual(r, barOf(r), TODAY);
    expect(p.overdue).toBe(12);
    expect(p.notes).toContain("Overdue by 12 days");
    expect(p.actualLine).toMatchObject({ endDay: toDay("2027-04-14"), running: true });
  });
  it("a Completed or Sunset initiative is never overdue, whatever its dates", () => {
    for (const phase of ["Completed", "Sunset"]) {
      const r = row("a1", "2027-02-01", "2027-04-02", { initiative_phase: phase });
      expect(planVsActual(r, barOf(r), TODAY).overdue).toBeNull();
    }
  });
  it("past Planned Start with no actual start says so; a future start does not", () => {
    const late = row("a1", "2027-04-01", "2027-06-01");
    expect(planVsActual(late, barOf(late), TODAY).startLate).toBe(13);
    const future = row("a2", "2027-05-01", "2027-06-01");
    expect(planVsActual(future, barOf(future), TODAY).startLate).toBeNull();
  });
});

describe("dependencies from depends_on", () => {
  it("parses codes separated by semicolons, commas or lines, once each", () => {
    expect(parseDeps("R-12; R-20, R-12\nR-3")).toEqual(["R-12", "R-20", "R-3"]);
    expect(parseDeps(null)).toEqual([]);
    expect(parseDeps("")).toEqual([]);
  });
  const rows = [
    row("a1", "2027-02-01", "2027-03-01"),
    row("a2", "2027-03-10", "2027-04-01", { depends_on: "A1" }),          // after A1: fine
    row("a3", "2027-02-20", "2027-03-30", { depends_on: "A1; A9; A4" }), // starts before A1 ends: clash; A9 unknown; A4 unscheduled
    row("a4", null, null),
    row("a5", "2027-04-05", "2027-05-01", { depends_on: "A2; A3" }),
    row("a6", "2027-04-05", "2027-05-01", { depends_on: "A6" }),          // itself: ignored
  ];
  const bars = classifyRows(rows).bars;
  const g = buildDeps(rows, bars);
  it("draws an edge per placed predecessor and marks the ones that start before the predecessor ends", () => {
    expect(g.edges).toEqual([
      { from: "a1", to: "a2", clash: false },
      { from: "a1", to: "a3", clash: true },
      { from: "a2", to: "a5", clash: false },
      { from: "a3", to: "a5", clash: false },
    ]);
    expect(g.counts.get("a3")).toEqual({ total: 3, clashes: 1 });
    expect(g.counts.has("a6")).toBe(false);
  });
  it("keeps the codes it cannot draw, so they can still be named", () => {
    expect(g.unplaced.get("a3")).toEqual(["A9", "A4"]);
  });
  it("the chain of an item is everything upstream and downstream, nothing beside it", () => {
    const c = chainOf(g.edges, "a2");
    expect([...c.ids].sort()).toEqual(["a1", "a2", "a5"]);
    expect(c.edges.size).toBe(2);
    expect([...chainOf(g.edges, "a4").ids]).toEqual(["a4"]);
  });
});

describe("gate markers and group roll-up", () => {
  it("a gate marker needs a next gate date and says gate and status in words", () => {
    expect(gateMarker(row("a1", null, null))).toBeNull();
    const m = gateMarker(row("a1", null, null, { next_gate_due: "2027-05-03", current_gate: "B", gate_status: "In review" }))!;
    expect(m.day).toBe(toDay("2027-05-03"));
    expect(m.text).toBe("Gate B, In review, due 2027-05-03");
  });
  it("counts At Risk, late and Blocked, and averages delivery progress over the items that have it", () => {
    const rows = [
      row("a1", "2027-02-01", "2027-03-01", { health: "At Risk", delivery_progress_pct: 40 }),
      row("a2", "2027-02-01", "2027-06-01", { health: "On Track", delivery_progress_pct: 80 }),
      row("a3", "2027-02-01", "2027-03-01", { health: "Blocked", initiative_phase: "Completed" }),
    ];
    const bars = new Map(classifyRows(rows).bars.map((b) => [b.id, b]));
    const r = rollup(rows, bars, TODAY);
    expect(r).toMatchObject({ atRisk: 1, late: 1, blocked: 1, progress: 60 });
    expect(r.text).toBe("1 at risk, 1 late, 1 blocked");
    expect(rollup([rows[1]!], bars, TODAY)).toMatchObject({ text: "No flags", progress: 80 });
    expect(rollup([row("a9", "2027-02-01", "2027-06-01")], bars, TODAY).progress).toBeNull();
  });
});

describe("zoom levels, fit and moving many", () => {
  const win = { startDay: toDay("2027-01-01"), endDay: toDay("2028-01-01") };
  it("week zoom has Monday weeks, year zoom has quarters", () => {
    const w = timelineTicks(win, "week");
    expect(w[1]!.label).toBe("4 Jan");
    expect(w[1]!.width).toBe(7 * PX_PER_DAY.week);
    expect(timelineTicks(win, "year").map((t) => t.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
  it("fit picks the finest zoom that shows the whole window, else Year", () => {
    expect(ZOOMS).toEqual(["week", "month", "quarter", "year"]);
    expect(fitZoom(win, 365 * 6 + 1)).toBe("month");
    expect(fitZoom(win, 365 * 2)).toBe("quarter");
    expect(fitZoom(win, 100)).toBe("year");
  });
  it("a set of bars moves together and stops when the first reaches the window edge", () => {
    const a = { startDay: toDay("2027-01-05"), endDay: toDay("2027-02-01") }, b = { startDay: toDay("2027-06-01"), endDay: toDay("2027-07-01") };
    expect(moveMany([a, b], 10, win)).toBe(10);
    expect(moveMany([a, b], -30, win)).toBe(toDay("2027-01-01") - a.startDay);
    expect(moveMany([a, b], 1000, win)).toBe(win.endDay - b.endDay);
    expect(moveMany([], 5, win)).toBe(0);
  });
  it("lists every group so Collapse all can close them", () => {
    const rows = [row("a1", "2027-02-01", "2027-03-01", { theme: "X" }), row("a2", "2027-02-01", "2027-03-01", { theme: "Y" })];
    const bars = classifyRows(rows).bars;
    const o = { g1: "theme", g2: null, label: (_f: string, v: unknown) => String(v), teamsOf: () => [] as string[] };
    expect(allGroupIds(rows, bars, o)).toEqual(["theme:X", "theme:Y"]);
    expect(layoutLines(rows, bars, { ...o, collapsed: new Set(["theme:X"]) }).filter((l) => l.kind === "item")).toHaveLength(1);
  });
});
