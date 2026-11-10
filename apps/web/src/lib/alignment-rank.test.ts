import { describe, expect, it } from "vitest";
import { planApply, suggestionRows, type SuggestionRow } from "./alignment-rank";

const item = (id: string, rank: number | null, over: Record<string, unknown> = {}) => ({ id, item_code: `R-${id}`, initiative_name: `Name ${id}`, stack_rank: rank, cycle_id: null, deleted_at: null, ...over });
const joint = [{ itemId: "a1", place: 1, tied: false }, { itemId: "a2", place: 2, tied: true }, { itemId: "a3", place: 2, tied: true }, { itemId: "a4", place: 4, tied: false }];
const links = [{ id: "a1", item_id: "i1" }, { id: "a2", item_id: "i2" }, { id: "a3", item_id: "i3" }, { id: "a4", item_id: "i4" }];

describe("the initiatives of a vote that can be reordered", () => {
  it("joins the vote to the initiatives and their Stack Rank", () => {
    const { rows, skipped } = suggestionRows(joint, links, [item("i1", 9), item("i2", 3), item("i3", 5), item("i4", 1)]);
    expect(skipped).toBe(0);
    expect(rows.map((r) => [r.code, r.place, r.from])).toEqual([["R-i1", 1, 9], ["R-i2", 2, 3], ["R-i3", 2, 5], ["R-i4", 4, 1]]);
  });
  it("leaves out a trashed initiative, one in another cycle, one that was removed from the session link and one without a rank, and counts them", () => {
    const { rows, skipped } = suggestionRows(joint, [...links.slice(0, 3), { id: "a4", item_id: null }], [item("i1", 9, { deleted_at: "2027-01-01" }), item("i2", 3, { cycle_id: "c1" }), item("i3", null)]);
    expect(rows).toEqual([]);
    expect(skipped).toBe(4);
  });
});

describe("what applying would do", () => {
  const rows: SuggestionRow[] = [
    { itemId: "i1", code: "R-1", name: "One", place: 1, tied: false, from: 9 },
    { itemId: "i2", code: "R-2", name: "Two", place: 2, tied: true, from: 5 },
    { itemId: "i3", code: "R-3", name: "Three", place: 2, tied: true, from: 3 },
    { itemId: "i4", code: "R-4", name: "Four", place: 4, tied: false, from: 1 },
  ];
  const seen = { i1: 9, i2: 5, i3: 3, i4: 1 };
  it("works the moves out from the vote and today's ranks, keeping ties in their current order", () => {
    const p = planApply(rows, ["i1", "i2", "i3", "i4"], seen);
    expect(p.ok && Object.fromEntries(p.moves.map((m) => [m.id, m.to]))).toEqual({ i1: 1, i3: 3, i2: 5, i4: 9 });
    expect(p.ok && p.scope).toBe("all");
    expect(p.ok && p.changed).toBe(2); // i3 and i2 hold their own positions among the tie; i1 and i4 swap
  });
  it("a selection is its own scope and reorders only the chosen initiatives", () => {
    const p = planApply(rows, ["i1", "i4"], seen);
    expect(p.ok && p.scope).toBe("selection");
    expect(p.ok && Object.fromEntries(p.moves.map((m) => [m.id, m.to]))).toEqual({ i1: 1, i4: 9 });
  });
  it("asks again when any chosen initiative is no longer at the rank the person saw", () => {
    expect(planApply(rows, ["i1", "i4"], { ...seen, i4: 2 })).toEqual({ ok: false, reason: "stale" });
    expect(planApply(rows, ["i1", "i4"], { i1: 9 })).toEqual({ ok: false, reason: "stale" });
  });
  it("needs two initiatives, and says so when the order already matches", () => {
    expect(planApply(rows, ["i1"], seen)).toEqual({ ok: false, reason: "pick-two" });
    expect(planApply(rows, [], seen)).toEqual({ ok: false, reason: "pick-two" });
    const sorted = rows.map((r, n) => ({ ...r, from: n + 1, place: n + 1, tied: false }));
    expect(planApply(sorted, sorted.map((r) => r.itemId), Object.fromEntries(sorted.map((r) => [r.itemId, r.from])))).toEqual({ ok: false, reason: "nothing" });
  });
  it("ignores an initiative that is not part of the vote", () => {
    expect(planApply(rows, ["i1", "i4", "not-in-vote"], { ...seen, "not-in-vote": 7 }).ok).toBe(true);
  });
});
