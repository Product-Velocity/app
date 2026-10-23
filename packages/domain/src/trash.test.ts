import { describe, expect, it } from "vitest";
import { canDeleteItem, canSeeTrash, canPurge, closeGaps, daysLeftInTrash, deleteSummary, hasHistory, placeRestored, TRASH_DAYS } from "./trash";

describe("who may delete", () => {
  it("admins any item; creators their own; nobody else", () => {
    expect(canDeleteItem("admin", "u1", "u2")).toBe(true);
    expect(canDeleteItem("creator", "u1", "u1")).toBe(true);
    expect(canDeleteItem("creator", "u1", "u2")).toBe(false);
    expect(canDeleteItem("creator", "u1", null)).toBe(false);
    for (const r of ["viewer", "commenter", "leadership", null]) expect(canDeleteItem(r, "u1", "u1")).toBe(false);
  });
  it("creators and admins see the Trash; only admins delete forever", () => {
    expect(canSeeTrash("creator")).toBe(true);
    expect(canSeeTrash("admin")).toBe(true);
    expect(canSeeTrash("viewer")).toBe(false);
    expect(canPurge("admin")).toBe(true);
    expect(canPurge("creator")).toBe(false);
  });
});

describe("ranks", () => {
  it("closeGaps renumbers 1..N in rank order", () => {
    const rows = [{ id: "a", stack_rank: 1 }, { id: "c", stack_rank: 4 }, { id: "d", stack_rank: 9 }];
    expect(closeGaps(rows).map((r) => [r.id, r.stack_rank])).toEqual([["a", 1], ["c", 2], ["d", 3]]);
  });
  it("placeRestored puts each item back at its old rank and shifts the rest", () => {
    const live = ["a", "c", "e", "f"]; // b (2) and d (4) were deleted from a..f
    expect(placeRestored(live, [{ id: "d", rank: 4 }, { id: "b", rank: 2 }])).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("an old rank beyond the end goes to the end", () => {
    expect(placeRestored(["a"], [{ id: "z", rank: 9 }])).toEqual(["a", "z"]);
    expect(placeRestored([], [{ id: "z", rank: 3 }])).toEqual(["z"]);
  });
  it("ties are broken by id so the result is stable", () => {
    expect(placeRestored(["a"], [{ id: "y", rank: 1 }, { id: "x", rank: 1 }])).toEqual(["y", "x", "a"]);
  });
});

describe("confirmation text", () => {
  it("says how many and lists the first few names", () => {
    expect(deleteSummary(["One"])).toEqual({ title: "Delete 1 initiative?", names: ["One"], more: 0 });
    const s = deleteSummary(["a", "b", "c", "d", "e", "f", "g"]);
    expect(s.title).toBe("Delete 7 initiatives?");
    expect(s.names).toHaveLength(5);
    expect(s.more).toBe(2);
  });
  it("history: an item with a decision, status or GitHub link has some", () => {
    expect(hasHistory({})).toBe(false);
    expect(hasHistory({ decision: "Go" })).toBe(true);
    expect(hasHistory({ status: "In Progress" })).toBe(true);
    expect(hasHistory({ github_issue_url: "https://x" })).toBe(true);
  });
  it("days left in the Trash count down from 30 and never go below 0", () => {
    const now = Date.UTC(2027, 3, 14);
    expect(TRASH_DAYS).toBe(30);
    expect(daysLeftInTrash("2027-04-14T00:00:00Z", now)).toBe(30);
    expect(daysLeftInTrash("2027-04-04T00:00:00Z", now)).toBe(20);
    expect(daysLeftInTrash("2027-01-01T00:00:00Z", now)).toBe(0);
  });
});
