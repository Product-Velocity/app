import { describe, expect, it } from "vitest";
import { addToBar, BAR_FULL_MESSAGE, changeSummary, computeBar, diffViews, layoutRowsFor, moveInBar, moveToIndex, nameProblem, removeFromBar, visibleTabs, type BarView, type LayoutRow, type ViewRef } from "./view-bar";
import { sanitizeView, sortRows } from "./views";

const b = (name: string): ViewRef => ({ kind: "builtin", name: name as never });
const s = (id: string): ViewRef => ({ kind: "saved", id });
const names = (refs: ViewRef[]) => refs.map((r) => (r.kind === "builtin" ? r.name : r.id));
const me = "u1";

describe("computeBar", () => {
  it("default workspace: six tabs and 5 more views", () => {
    const st = computeBar({ views: [], workspaceLayout: [], myLayout: [], me });
    expect(names(st.bar)).toEqual(["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership"]);
    expect(st.moreCount).toBe(5);
    expect(st.workspace.filter((e) => !e.inBar).map((e) => e.name)).toEqual(["Discovery", "Timeline", "History", "Cycle review", "All columns"]);
    expect(st.followsWorkspace).toBe(true);
  });
  it("a private view not in the bar adds to the count and shows under My views; someone else's never shows", () => {
    const views: BarView[] = [{ id: "p1", name: "Mine", ownerId: me }, { id: "p2", name: "Theirs", ownerId: "u2" }, { id: "w1", name: "Shared", ownerId: null }];
    const st = computeBar({ views, workspaceLayout: [], myLayout: [], me });
    expect(st.mine.map((e) => e.name)).toEqual(["Mine"]);
    expect(st.workspace.map((e) => e.name)).toContain("Shared");
    expect(st.moreCount).toBe(7);
    expect([...st.mine, ...st.workspace].some((e) => e.name === "Theirs")).toBe(false);
  });
  it("the admin's workspace layout is the default for everyone who has no layout of their own", () => {
    const ws: LayoutRow[] = [{ ref: b("Timeline"), inBar: true, position: 0 }, { ref: b("Planning"), inBar: true, position: 1 }];
    expect(names(computeBar({ views: [], workspaceLayout: ws, myLayout: [], me }).bar)).toEqual(["Timeline", "Planning"]);
  });
  it("a person's layout overrides the workspace default and leaves other people's bars alone", () => {
    const ws: LayoutRow[] = [{ ref: b("Timeline"), inBar: true, position: 0 }];
    const mine = layoutRowsFor([b("Delivery"), b("Planning")], [b("Delivery"), b("Planning"), b("Timeline")]);
    expect(names(computeBar({ views: [], workspaceLayout: ws, myLayout: mine, me }).bar)).toEqual(["Delivery", "Planning"]);
    expect(names(computeBar({ views: [], workspaceLayout: ws, myLayout: [], me: "u9" }).bar)).toEqual(["Timeline"]);
  });
  it("resetting (no rows) goes back to the workspace layout", () => {
    expect(computeBar({ views: [], workspaceLayout: [], myLayout: [], me }).followsWorkspace).toBe(true);
  });
  it("a workspace view added after the person customised shows as New; not for people who follow the default", () => {
    const views: BarView[] = [{ id: "w1", name: "Later", ownerId: null }];
    const mine = layoutRowsFor([b("Planning")], [b("Planning")]);
    expect(computeBar({ views, workspaceLayout: [], myLayout: mine, me }).workspace.find((e) => e.name === "Later")?.isNew).toBe(true);
    expect(computeBar({ views, workspaceLayout: [], myLayout: [], me }).workspace.find((e) => e.name === "Later")?.isNew).toBe(false);
  });
  it("a hidden built-in is in neither the bar nor the menu, but listed under hidden", () => {
    const ws: LayoutRow[] = [{ ref: b("Timeline"), inBar: false, position: 9, hidden: true }];
    const st = computeBar({ views: [], workspaceLayout: ws, myLayout: [], me });
    expect(st.workspace.some((e) => e.name === "Timeline")).toBe(false);
    expect(st.hidden.map((e) => e.name)).toEqual(["Timeline"]);
    expect(st.moreCount).toBe(4);
  });
  it("a customised built-in is still the built-in; a deleted view disappears from a layout", () => {
    const views: BarView[] = [{ id: "o1", name: "Planning", ownerId: null, baseView: "Planning" }];
    expect(computeBar({ views, workspaceLayout: [], myLayout: [], me }).workspace.filter((e) => e.name === "Planning")).toHaveLength(1);
    const mine = layoutRowsFor([s("gone"), b("Planning")], [s("gone"), b("Planning")]);
    expect(names(computeBar({ views: [], workspaceLayout: [], myLayout: mine, me }).bar)).toEqual(["Planning"]);
  });
});

describe("editing the bar", () => {
  const six = ["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership"].map(b);
  it("refuses a seventh view with the message and changes nothing", () => {
    const r = addToBar(six, b("Timeline"));
    expect(r).toEqual({ ok: false, error: BAR_FULL_MESSAGE });
    expect(BAR_FULL_MESSAGE).toBe("Your bar is full (6). Remove one first.");
  });
  it("adds, removes and reorders", () => {
    const five = removeFromBar(six, b("Outcomes"));
    const r = addToBar(five, b("Timeline"));
    expect(r.ok && names(r.bar)).toEqual(["Prioritisation", "Planning", "Delivery", "Go-to-market", "Leadership", "Timeline"]);
    expect(names(moveInBar(six, b("Delivery"), -1)).slice(0, 3)).toEqual(["Prioritisation", "Delivery", "Planning"]);
    expect(names(moveInBar(six, b("Prioritisation"), -1))).toEqual(names(six));
    expect(names(moveInBar(six, b("Leadership"), 1))).toEqual(names(six));
    expect(names(moveToIndex(six, b("Leadership"), 1))[1]).toBe("Leadership");
  });
  it("a workspace view moved into slot 2 is stored for that person only", () => {
    const bar = moveToIndex(addToBar(removeFromBar(six, b("Outcomes")), s("w1")).ok ? [...removeFromBar(six, b("Outcomes")), s("w1")] : [], s("w1"), 1);
    const rows = layoutRowsFor(bar, [...six, s("w1")]);
    expect(rows.filter((r) => r.inBar).sort((x, y) => x.position - y.position).map((r) => (r.ref.kind === "saved" ? r.ref.id : r.ref.name))[1]).toBe("w1");
    expect(rows.find((r) => r.ref.kind === "builtin" && r.ref.name === "Outcomes")?.inBar).toBe(false);
  });
});

describe("visibleTabs", () => {
  it("shows the open view as a temporary extra tab when it is not in the bar", () => {
    const bar = [b("Planning"), b("Delivery")];
    expect(visibleTabs(bar, b("Timeline"), 6).extra).toEqual(b("Timeline"));
    expect(visibleTabs(bar, b("Planning"), 6).extra).toBeNull();
  });
  it("fewer tabs on a narrow window; the rest overflow", () => {
    const bar = ["a", "b", "c", "d"].map(s);
    expect(visibleTabs(bar, null, 2)).toMatchObject({ overflow: 2 });
    expect(visibleTabs(bar, null, 0).tabs).toHaveLength(1);
  });
});

describe("names and change summary", () => {
  it("validates names per owner", () => {
    expect(nameProblem("  ", [])).toMatch(/name/);
    expect(nameProblem("x".repeat(81), [])).toMatch(/80/);
    expect(nameProblem(" planning ", ["Planning"])).toMatch(/already/);
    expect(nameProblem("Fine", ["Planning"])).toBeNull();
  });
  it("says what changed", () => {
    expect(changeSummary({ filters: 1, columns: 2, grouping: false, sorted: true, pinned: false })).toBe("1 filter, 2 columns, sorted");
  });
  it("sees a changed column, filter, grouping or sort, and nothing else", () => {
    const base = { columns: ["a", "b"], filters: [], groupBy: null, sort: null };
    expect(diffViews(base, { ...base, columns: ["a", "b", "c"] }).columns).toBe(1);
    expect(diffViews(base, { ...base, columns: ["b", "a"] }).columns).toBe(1);
    expect(diffViews(base, { ...base, filters: [{ field: "x" }] }).filters).toBe(1);
    expect(diffViews(base, { ...base, groupBy: "moscow" }).grouping).toBe(true);
    expect(diffViews(base, { ...base, sort: { field: "moscow", dir: "asc" } }).sorted).toBe(true);
    expect(diffViews(base, { ...base })).toEqual({ filters: 0, columns: 0, grouping: false, sorted: false, pinned: false });
  });
});

describe("sort", () => {
  const rows = [{ stack_rank: 1, moscow: "Should", n: 3 }, { stack_rank: 2, moscow: null, n: 1 }, { stack_rank: 3, moscow: "Must", n: 2 }, { stack_rank: 4, moscow: "Must", n: null }];
  it("sorts one field, empty last either way, ties by stack rank", () => {
    expect(sortRows(rows, { field: "moscow", dir: "asc" }).map((r) => r.stack_rank)).toEqual([3, 4, 1, 2]);
    expect(sortRows(rows, { field: "moscow", dir: "desc" }).map((r) => r.stack_rank)).toEqual([1, 3, 4, 2]);
    expect(sortRows(rows, { field: "n", dir: "asc" }).map((r) => r.stack_rank)).toEqual([2, 3, 1, 4]);
    expect(sortRows(rows, null).map((r) => r.stack_rank)).toEqual([1, 2, 3, 4]);
  });
  it("is kept by sanitizeView only for real fields, and customer-safe views keep only safe ones", () => {
    expect(sanitizeView({ columns: ["moscow"], sort: { field: "moscow", dir: "desc" } }).sort).toEqual({ field: "moscow", dir: "desc" });
    expect(sanitizeView({ columns: ["moscow"], sort: { field: "nope", dir: "asc" } }).sort).toBeUndefined();
    expect(sanitizeView({ columns: ["item_code"], customerSafe: true, sort: { field: "value_12m", dir: "asc" } }).sort).toBeUndefined();
    expect(sanitizeView({ columns: ["moscow"], sort: { field: "moscow", dir: "sideways" } }).sort?.dir).toBe("asc");
  });
});
