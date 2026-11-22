import { describe, expect, it } from "vitest";
import { SNOOZE_CHOICES, attentionCounts, attentionList, snoozeActive, snoozeDate, type Snooze } from "./attention";
import { attentionCsv, attentionGridRows, bulkMoveSplit, facetCounts, filterAttentionRows, kindCounts } from "./attention-grid";

const TODAY = new Date(Date.UTC(2027, 3, 14)); // 14 Apr 2027
const row = (n: number, o: Record<string, unknown> = {}) => ({ id: `i${n}`, item_code: `R-${n}`, initiative_name: `Item ${n}`, stack_rank: n, initiative_status: "Active", health: "On Track", ...o });
const build = (rows: ReturnType<typeof row>[], snoozes: Snooze[] = []) => {
  const entries = attentionList(rows, TODAY, { snoozes });
  return { entries, grid: attentionGridRows(entries, rows, { today: TODAY, person: (id) => (id === "u1" ? "ana" : ""), project: (id) => (id === "p1" ? "Web" : id) }) };
};
const rows = [
  row(1, { initiative_phase: "Build", status: "Done", theme: "Growth", product_manager: "u1", home_project: "p1" }),
  row(2, { initiative_phase: "Define", status: "In progress" }),
  row(3, { health: "Blocked", initiative_phase: "Build", status: "In progress", phase_changed_at: "2027-04-10" }),
  row(4, { initiative_phase: "Define", phase_changed_at: "2027-02-01" }),
];

describe("snoozing a reason of Needs attention", () => {
  it("a snooze hides through its date, a dismissal until it is removed", () => {
    expect(snoozeActive({ snoozed_until: "2027-04-14" }, "2027-04-14")).toBe(true);
    expect(snoozeActive({ snoozed_until: "2027-04-13" }, "2027-04-14")).toBe(false);
    expect(snoozeActive({ snoozed_until: null }, "2027-04-14")).toBe(true);
    expect(snoozeDate("2027-04-14", 7)).toBe("2027-04-21");
    expect(snoozeDate("2027-12-30", 3)).toBe("2028-01-02");
    expect(SNOOZE_CHOICES.map((c) => c.days)).toEqual([1, 7, 14, 30]);
  });

  it("marks the reason as snoozed (kept, not dropped) and the entry as snoozed when every reason is", () => {
    const { entries } = build(rows, [{ item_id: "i1", kind: "build-done", snoozed_until: "2027-04-20" }]);
    const e1 = entries.find((e) => e.id === "i1")!;
    expect(e1.reasons[0]).toMatchObject({ kind: "build-done", snoozed: { until: "2027-04-20", note: null } });
    expect(e1.snoozed).toBe(true);
    expect(entries.find((e) => e.id === "i2")!.snoozed).toBe(false);
  });

  it("only the snoozed reason is hidden: a second reason keeps the entry on the list", () => {
    const rs = [row(1, { initiative_phase: "Define", status: "In progress", phase_changed_at: "2027-01-01" })];
    const { entries } = build(rs, [{ item_id: "i1", kind: "stalled", snoozed_until: null }]);
    expect(entries[0]!.snoozed).toBe(false);
    expect(entries[0]!.reasons.filter((r) => !r.snoozed).map((r) => r.kind)).toEqual(["tracker-early"]);
  });

  it("an expired snooze no longer hides, and one initiative's snooze never hides another's", () => {
    const { entries } = build(rows, [{ item_id: "i1", kind: "build-done", snoozed_until: "2027-04-13" }, { item_id: "i2", kind: "build-done", snoozed_until: null }]);
    expect(entries.find((e) => e.id === "i1")!.snoozed).toBe(false);
    expect(entries.find((e) => e.id === "i2")!.snoozed).toBe(false);
  });

  it("the urgency counts only reasons that are not snoozed", () => {
    const { entries } = build(rows);
    expect(entries.find((e) => e.id === "i3")!.tier).toBe(0);
    const snoozed = build(rows, [{ item_id: "i3", kind: "delivery-risk", snoozed_until: null }]).entries.find((e) => e.id === "i3")!;
    expect(snoozed.snoozed).toBe(true);
    expect(attentionCounts([snoozed])["delivery-risk"]).toBe(0);
  });

  it("without snoozes nothing changes (the Changes report and the phone screen use the list as before)", () => {
    expect(attentionList(rows, TODAY).every((e) => !e.snoozed && e.reasons.every((r) => !r.snoozed))).toBe(true);
  });
});

describe("the Needs attention grid rows", () => {
  it("one row per initiative with the values a person sorts and filters by", () => {
    const { grid } = build(rows);
    const r1 = grid.find((g) => g.id === "i1")!;
    expect(r1).toMatchObject({ code: "R-1", urgency: "Look at it", phase: "Build", group: "Growth", owner: "ana", project: "Web", kinds: ["build-done"], reasonLabels: "Build done" });
    expect(r1.actions).toEqual([{ kind: "build-done", action: { type: "move", to: "Test", label: "Move to Test" } }]);
    expect(grid.find((g) => g.id === "i3")).toMatchObject({ urgency: "Urgent", health: "Blocked" });
    expect(grid.find((g) => g.id === "i4")!.daysInPhase).toBe(72);
  });

  it("filters by reason, urgency, phase, search words and one-click, and hides snoozed rows unless asked", () => {
    const { grid } = build(rows, [{ item_id: "i2", kind: "tracker-early", snoozed_until: null }]);
    expect(filterAttentionRows(grid, {}).map((r) => r.code)).toEqual(["R-3", "R-1", "R-4"]); // urgent first
    expect(filterAttentionRows(grid, { showSnoozed: true }).map((r) => r.code)).toContain("R-2");
    expect(filterAttentionRows(grid, { kinds: ["stalled"] }).map((r) => r.code)).toEqual(["R-4"]);
    expect(filterAttentionRows(grid, { urgencies: ["Urgent"] }).map((r) => r.code)).toEqual(["R-3"]);
    expect(filterAttentionRows(grid, { phases: ["Define"] }).map((r) => r.code)).toEqual(["R-4"]);
    expect(filterAttentionRows(grid, { search: "growth build" }).map((r) => r.code)).toEqual(["R-1"]);
    expect(filterAttentionRows(grid, { actionable: true }).map((r) => r.code)).toEqual(["R-1"]);
    expect(filterAttentionRows(grid, { phases: ["No phase"] })).toEqual([]);
  });

  it("counts for the chips follow the other filters, and facets are sorted by size", () => {
    const { grid } = build(rows);
    expect(kindCounts(grid)["delivery-risk"]).toBe(1);
    expect(facetCounts(grid, (r) => r.phase)[0]).toEqual({ value: "Build", count: 2 });
    expect(facetCounts(grid, (r) => r.group)).toContainEqual({ value: "None", count: 3 });
  });

  it("a bulk move only takes the rows with a move to Test; the others are listed with the reason", () => {
    const { grid } = build(rows);
    const { movable, skipped } = bulkMoveSplit(grid);
    expect(movable.map((r) => r.code)).toEqual(["R-1"]);
    expect(skipped).toHaveLength(3);
  });

  it("the CSV quotes what needs it and does not let a spreadsheet run a formula", () => {
    const rs = [row(1, { initiative_name: '=HYPERLINK("x")', initiative_phase: "Build", status: "Done", theme: "A, B" })];
    const { grid } = build(rs);
    const csv = attentionCsv(grid).split("\n");
    expect(csv[0]).toMatch(/^Code,Initiative,Urgency/);
    expect(csv[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv[1]).toContain('"A, B"');
  });

  it("has no per-person columns beyond the Product Manager of the initiative", () => {
    const { grid } = build(rows);
    expect(Object.keys(grid[0]!).filter((k) => /person|user|author|assignee|velocity/i.test(k))).toEqual([]);
  });
});
