import { describe, expect, it } from "vitest";
import {
  PX_PER_DAY, applyKey, classifyRows, clampWindow, dayToX, defaultWindow, fromDay, ganttGroupOptions, layoutLines, moveRange, resizeRange, scheduleAt,
  summarizeChange, timelineTicks, toDay, xToDay, type Line,
} from "./gantt";

const row = (id: string, planned_start: string | null, g2m_date_est: string | null, extra: Record<string, unknown> = {}) => ({ id, item_code: id.toUpperCase(), initiative_name: `Item ${id}`, stack_rank: Number(id.replace(/\D/g, "")) || 1, planned_start, g2m_date_est, ...extra });

describe("dates as day numbers", () => {
  it("round-trips ISO dates, month ends and leap days", () => {
    for (const d of ["2027-03-31", "2028-02-29", "2027-12-31", "2027-01-01"]) expect(fromDay(toDay(d))).toBe(d);
    expect(toDay("2027-03-02") - toDay("2027-03-01")).toBe(1);
    expect(toDay("2028-03-01") - toDay("2028-02-28")).toBe(2);
  });
});

describe("classifyRows: which items have a bar", () => {
  it("a bar needs Planned Start and G2M Date (est), the end not before the start", () => {
    const r = classifyRows([row("a1", "2027-03-01", "2027-04-30"), row("a2", null, "2027-04-30"), row("a3", "2027-03-01", null), row("a4", null, null), row("a5", "2027-05-01", "2027-04-01"), row("a6", "2027-03-01", "2027-03-01")]);
    expect(r.bars.map((b) => b.id)).toEqual(["a1", "a6"]);
    expect(r.bars[0]).toMatchObject({ start: "2027-03-01", end: "2027-04-30", endDay: toDay("2027-04-30") });
    expect(r.unscheduled).toEqual([
      { id: "a2", reason: "No Planned Start" }, { id: "a3", reason: "No G2M Date (est)" }, { id: "a4", reason: "No dates" }, { id: "a5", reason: "G2M Date (est) is before Planned Start" },
    ]);
  });
  it("ignores values that are not dates", () => {
    expect(classifyRows([row("a1", "soon", "2027-04-30")]).unscheduled[0]).toEqual({ id: "a1", reason: "No Planned Start" });
  });
});

describe("the timeline scale", () => {
  const win = { startDay: toDay("2027-01-01"), endDay: toDay("2028-01-01") };
  it("maps days to pixels and back at both zooms", () => {
    for (const z of ["month", "quarter"] as const) {
      const d = toDay("2027-06-15");
      expect(xToDay(dayToX(d, win, z), win, z)).toBe(d);
      expect(dayToX(win.startDay, win, z)).toBe(0);
    }
    expect(PX_PER_DAY.month).toBeGreaterThan(PX_PER_DAY.quarter);
  });
  it("labels months in month zoom and quarters in quarter zoom, with year headings", () => {
    const m = timelineTicks(win, "month");
    expect(m.slice(0, 3).map((t) => t.label)).toEqual(["Jan", "Feb", "Mar"]);
    expect(m).toHaveLength(12);
    expect(m[1]!.x).toBe(31 * PX_PER_DAY.month);
    const q = timelineTicks(win, "quarter");
    expect(q.map((t) => t.label)).toEqual(["Q1 2027", "Q2 2027", "Q3 2027", "Q4 2027"]);
  });
  it("starts the default window at a month start, covers the bars and today, and is never shorter than 9 months", () => {
    const bars = classifyRows([row("a1", "2027-03-10", "2027-04-20")]).bars;
    const w = defaultWindow(bars, new Date(Date.UTC(2027, 3, 14)));
    expect(fromDay(w.startDay).endsWith("-01")).toBe(true);
    expect(w.startDay).toBeLessThanOrEqual(toDay("2027-03-10"));
    expect(w.endDay).toBeGreaterThan(toDay("2027-04-20"));
    expect(w.endDay - w.startDay).toBeGreaterThanOrEqual(270);
    const wide = defaultWindow(classifyRows([row("a1", "2026-01-15", "2028-06-15")]).bars, new Date(Date.UTC(2027, 3, 14)));
    expect(wide.startDay).toBeLessThanOrEqual(toDay("2026-01-15"));
    expect(wide.endDay).toBeGreaterThan(toDay("2028-06-15"));
  });
  it("widening the window keeps its month alignment", () => {
    const w = clampWindow({ startDay: toDay("2027-02-10"), endDay: toDay("2027-03-05") }, 0);
    expect(fromDay(w.startDay)).toBe("2027-02-01");
    expect(fromDay(w.endDay)).toBe("2027-04-01");
  });
});

describe("move and resize, clamped to the window", () => {
  const win = { startDay: toDay("2027-01-01"), endDay: toDay("2027-12-31") };
  const bar = { startDay: toDay("2027-03-01"), endDay: toDay("2027-03-31") };
  it("moving keeps the length", () => {
    expect(moveRange(bar, 10, win)).toEqual({ startDay: bar.startDay + 10, endDay: bar.endDay + 10 });
    expect(moveRange(bar, -5, win)).toEqual({ startDay: bar.startDay - 5, endDay: bar.endDay - 5 });
  });
  it("stops at the window edges without changing the length", () => {
    const left = moveRange(bar, -1000, win);
    expect(left.startDay).toBe(win.startDay);
    expect(left.endDay - left.startDay).toBe(bar.endDay - bar.startDay);
    const right = moveRange(bar, 1000, win);
    expect(right.endDay).toBe(win.endDay);
    expect(right.endDay - right.startDay).toBe(bar.endDay - bar.startDay);
  });
  it("resizing moves one edge, never past the other (a bar is at least one day) or out of the window", () => {
    expect(resizeRange(bar, "end", 7, win)).toEqual({ startDay: bar.startDay, endDay: bar.endDay + 7 });
    expect(resizeRange(bar, "start", -7, win)).toEqual({ startDay: bar.startDay - 7, endDay: bar.endDay });
    expect(resizeRange(bar, "end", -1000, win)).toEqual({ startDay: bar.startDay, endDay: bar.startDay });
    expect(resizeRange(bar, "start", 1000, win)).toEqual({ startDay: bar.endDay, endDay: bar.endDay });
    expect(resizeRange(bar, "end", 5000, win).endDay).toBe(win.endDay);
    expect(resizeRange(bar, "start", -5000, win).startDay).toBe(win.startDay);
  });
  it("a bar longer than the window cannot be moved out of it", () => {
    const long = { startDay: win.startDay - 10, endDay: win.endDay + 10 };
    expect(moveRange(long, 5, win)).toEqual(long);
  });
});

describe("keyboard: arrows stage a change", () => {
  const win = { startDay: toDay("2027-01-01"), endDay: toDay("2027-12-31") };
  const bar = { startDay: toDay("2027-03-01"), endDay: toDay("2027-03-31") };
  const key = (k: string, o: { shift?: boolean; alt?: boolean } = {}) => applyKey(bar, { key: k, shift: !!o.shift, alt: !!o.alt }, win);
  it("arrows move the bar by a day, Shift by a week", () => {
    expect(key("ArrowRight")).toEqual(moveRange(bar, 1, win));
    expect(key("ArrowLeft", { shift: true })).toEqual(moveRange(bar, -7, win));
  });
  it("Alt changes the end date, Alt+Shift the start date", () => {
    expect(key("ArrowRight", { alt: true })).toEqual(resizeRange(bar, "end", 1, win));
    expect(key("ArrowLeft", { alt: true, shift: true })).toEqual(resizeRange(bar, "start", -1, win));
  });
  it("other keys do nothing", () => {
    expect(key("a")).toBeNull();
    expect(key("ArrowUp")).toBeNull();
  });
});

describe("summarizeChange", () => {
  it("says what changes in words with both dates", () => {
    const before = { startDay: toDay("2027-03-01"), endDay: toDay("2027-03-31") };
    const today = new Date(Date.UTC(2027, 3, 14));
    expect(summarizeChange(before, { startDay: before.startDay + 7, endDay: before.endDay + 7 }, today)).toBe("Planned Start 1 Mar to 8 Mar, G2M Date (est) 31 Mar to 7 Apr");
    expect(summarizeChange(before, { startDay: before.startDay, endDay: before.endDay + 3 }, today)).toBe("G2M Date (est) 31 Mar to 3 Apr");
    expect(summarizeChange(before, before, today)).toBe("No change");
  });
});

describe("scheduleAt: dropping an unscheduled item on the timeline", () => {
  const win = { startDay: toDay("2027-01-01"), endDay: toDay("2027-12-31") };
  it("starts at the drop day and lasts four weeks by default", () => {
    expect(scheduleAt(toDay("2027-05-03"), null, win)).toEqual({ startDay: toDay("2027-05-03"), endDay: toDay("2027-05-03") + 27 });
  });
  it("keeps an existing later G2M date, and keeps an existing length when only the start was missing", () => {
    expect(scheduleAt(toDay("2027-05-03"), { endDay: toDay("2027-07-01") }, win)).toEqual({ startDay: toDay("2027-05-03"), endDay: toDay("2027-07-01") });
    expect(scheduleAt(toDay("2027-08-01"), { endDay: toDay("2027-07-01") }, win)).toEqual({ startDay: toDay("2027-08-01"), endDay: toDay("2027-08-01") + 27 });
  });
  it("is clamped to the window", () => {
    const r = scheduleAt(toDay("2027-12-20"), null, win);
    expect(r.endDay).toBe(win.endDay);
    expect(r.startDay).toBe(win.endDay - 27);
  });
});

describe("grouping", () => {
  const rows = [
    row("a1", "2027-03-01", "2027-04-01", { theme: "Retention", home_project: "p2" }),
    row("a2", "2027-03-05", "2027-04-10", { theme: "Onboarding", home_project: "p1" }),
    row("a3", "2027-03-07", "2027-05-10", { theme: "Onboarding", home_project: "p2" }),
    row("a4", "2027-02-01", "2027-02-20", { theme: null, home_project: "p1" }),
  ];
  const { bars } = classifyRows(rows);
  const label = (field: string, v: unknown) => (v == null || v === "" ? "No value" : field === "home_project" ? (v === "p1" ? "Platform" : "Marketplace") : String(v));
  const lines = (g1: string | null, g2: string | null, collapsed: string[] = []) =>
    layoutLines(rows, bars, { g1, g2, collapsed: new Set(collapsed), label, teamsOf: () => [] });
  const text = (ls: Line[]) => ls.map((l) => (l.kind === "group" ? `${"  ".repeat(l.level - 1)}${l.label} (${l.count})` : `    ${l.itemId}`));

  it("two levels: Initiative Group, then project; groups A to Z, 'No value' last, items by rank inside", () => {
    expect(text(lines("theme", "home_project"))).toEqual([
      "Onboarding (2)", "  Marketplace (1)", "    a3", "  Platform (1)", "    a2",
      "Retention (1)", "  Marketplace (1)", "    a1",
      "No value (1)", "  Platform (1)", "    a4",
    ]);
  });
  it("one level, and no grouping at all", () => {
    expect(text(lines("theme", null))).toEqual(["Onboarding (2)", "    a2", "    a3", "Retention (1)", "    a1", "No value (1)", "    a4"]);
    expect(text(lines(null, null))).toEqual(["    a1", "    a2", "    a3", "    a4"]);
  });
  it("a collapsed group hides its lines but keeps its count and ids stay unique", () => {
    const ls = lines("theme", "home_project", ["theme:Onboarding"]);
    expect(text(ls).slice(0, 2)).toEqual(["Onboarding (2)", "Retention (1)"]);
    expect(ls[0]).toMatchObject({ collapsed: true, id: "theme:Onboarding" });
    expect(new Set(ls.map((l) => l.id)).size).toBe(ls.length);
  });
  it("a group carries the span of its bars, for the summary bar", () => {
    const g = lines("theme", null)[0] as Extract<Line, { kind: "group" }>;
    expect(g.span).toEqual({ startDay: toDay("2027-03-05"), endDay: toDay("2027-05-10") });
  });
  it("team grouping puts an item under each of its teams, and under 'No team' when it has none", () => {
    const ls = layoutLines(rows, bars, { g1: "team", g2: null, collapsed: new Set(), label, teamsOf: (r) => (r.id === "a1" ? ["Core", "Mobile"] : r.id === "a2" ? ["Core"] : []) });
    expect(text(ls)).toEqual(["Core (2)", "    a1", "    a2", "Mobile (1)", "    a1", "No value (2)", "    a3", "    a4"]);
    expect(new Set(ls.map((l) => l.id)).size).toBe(ls.length);
  });
});

describe("ganttGroupOptions", () => {
  it("offers none, project, team and the shipped select fields, Initiative Group first among fields", () => {
    const o = ganttGroupOptions();
    expect(o.slice(0, 3).map((x) => x.key)).toEqual(["", "theme", "home_project"]);
    expect(o.map((x) => x.key)).toEqual(expect.arrayContaining(["team", "roadmap_category", "initiative_phase", "focus_area", "health", "moscow", "horizon"]));
    expect(o.find((x) => x.key === "status")).toBeUndefined(); // Initiative Status comes from GitHub
    expect(o.find((x) => x.key === "")!.label).toBe("No grouping");
  });
});
