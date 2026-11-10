import { describe, expect, it } from "vitest";
import { changedMoves, describeMove, describeRanks, isReorder, suggestOrder, type VotedItem } from "./rank-suggestion";

const item = (id: string, stackRank: number, place: number, tied = false): VotedItem => ({ id, stackRank, place, tied });
const to = (moves: ReturnType<typeof suggestOrder>) => Object.fromEntries(moves.map((m) => [m.id, m.to]));

describe("the order a vote suggests", () => {
  it("gives the best place the best of the positions the voted initiatives hold", () => {
    // the team has a=2, b=5, c=9 (others, not voted, sit at 1, 3, 4, ...); the crowd prefers c, then a, then b
    const moves = suggestOrder([item("a", 2, 2), item("b", 5, 3), item("c", 9, 1)]);
    expect(to(moves)).toEqual({ c: 2, a: 5, b: 9 });
    expect(moves.map((m) => m.id)).toEqual(["c", "a", "b"]); // in suggested order
    expect(isReorder(moves)).toBe(true);
  });

  it("only moves among the positions the voted initiatives already hold, so nothing outside the vote can move", () => {
    const moves = suggestOrder([item("a", 3, 2), item("b", 4, 1), item("c", 10, 3)]);
    expect(moves.map((m) => m.to).sort((x, y) => x - y)).toEqual([3, 4, 10]);
  });

  it("keeps tied initiatives in their current order, whatever order they arrive in", () => {
    const tied = [item("a", 7, 2, true), item("b", 3, 2, true), item("c", 5, 1)];
    expect(to(suggestOrder(tied))).toEqual({ c: 3, b: 5, a: 7 });
    expect(to(suggestOrder([...tied].reverse()))).toEqual({ c: 3, b: 5, a: 7 });
  });

  it("changes nothing when the team already ranks them as the vote does", () => {
    const moves = suggestOrder([item("a", 1, 1), item("b", 2, 2), item("c", 6, 3)]);
    expect(changedMoves(moves)).toEqual([]);
  });

  it("works on a selection alone: the chosen initiatives reorder among their own positions", () => {
    // five were voted; the person selects only b and d
    const all = [item("a", 1, 3), item("b", 2, 5), item("c", 3, 1), item("d", 4, 2), item("e", 5, 4)];
    const chosen = all.filter((i) => i.id === "b" || i.id === "d");
    expect(to(suggestOrder(chosen))).toEqual({ d: 2, b: 4 });
  });

  it("a single initiative stays where it is, and an empty list gives nothing", () => {
    expect(changedMoves(suggestOrder([item("a", 4, 1)]))).toEqual([]);
    expect(suggestOrder([])).toEqual([]);
  });
});

describe("wording and the reorder check", () => {
  it("writes a move in words, with the better rank as up", () => {
    expect(describeMove({ from: 9, to: 2 })).toBe("up 7");
    expect(describeMove({ from: 2, to: 5 })).toBe("down 3");
    expect(describeMove({ from: 4, to: 4 })).toBe("stays");
    expect(describeRanks({ from: 9, to: 2 })).toBe("#9 to #2");
  });
  it("only a reorder of the same positions passes", () => {
    expect(isReorder([{ from: 2, to: 5 }, { from: 5, to: 2 }])).toBe(true);
    expect(isReorder([{ from: 2, to: 5 }, { from: 5, to: 6 }])).toBe(false); // would take a position nobody gave up
    expect(isReorder([{ from: 2, to: 5 }, { from: 5, to: 5 }])).toBe(false); // two initiatives on one position
  });
});

import { REASON_MAX, assignRanks, cleanReason, differences, isPermutationOf, moveInOrder } from "./rank-suggestion";

describe("deciding the final order (issue #397)", () => {
  const held = [{ id: "a", stackRank: 2 }, { id: "b", stackRank: 5 }, { id: "c", stackRank: 9 }];
  const votes = new Map([["a", { place: 2, tied: false }], ["b", { place: 3, tied: false }], ["c", { place: 1, tied: false }]]);
  const crowd = suggestOrder([item("a", 2, 2), item("b", 5, 3), item("c", 9, 1)]);

  it("gives the i-th initiative of the chosen order the i-th best held position", () => {
    const moves = assignRanks(["b", "c", "a"], held, votes);
    expect(Object.fromEntries(moves.map((m) => [m.id, m.to]))).toEqual({ b: 2, c: 5, a: 9 });
    expect(isReorder(moves)).toBe(true);
  });

  it("the vote's own suggestion is the same rule applied to the crowd's order", () => {
    const viaOrder = assignRanks(crowd.map((m) => m.id), held, votes);
    expect(viaOrder.map((m) => [m.id, m.to])).toEqual(crowd.map((m) => [m.id, m.to]));
  });

  it("finds exactly the initiatives that differ from the vote, also one that stays put against a vote that moves it", () => {
    expect(differences(assignRanks(crowd.map((m) => m.id), held, votes), crowd)).toEqual([]);
    // the vote says c, a, b (c #2, a #5, b #9); the person keeps a and b where they are and only swaps c in front of nothing: a, b, c
    const kept = assignRanks(["a", "b", "c"], held, votes);
    const d = differences(kept, crowd);
    expect(d.map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
    expect(d.find((x) => x.id === "a")).toEqual({ id: "a", from: 2, crowd: 5, final: 2 }); // it stays, the vote moves it down: still a difference
    // moving only the last two leaves c first: a differs, c does not
    const some = assignRanks(["c", "b", "a"], held, votes);
    expect(differences(some, crowd).map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("checks that an order lists the chosen initiatives once each", () => {
    expect(isPermutationOf(["b", "a", "c"], ["a", "b", "c"])).toBe(true);
    expect(isPermutationOf(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isPermutationOf(["a", "a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isPermutationOf(["a", "b", "x"], ["a", "b", "c"])).toBe(false);
  });

  it("moves one initiative to a place, clamping outside the list and leaving the rest in order", () => {
    expect(moveInOrder(["a", "b", "c", "d"], "d", 1)).toEqual(["d", "a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c", "d"], "a", 3)).toEqual(["b", "c", "a", "d"]);
    expect(moveInOrder(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
    expect(moveInOrder(["a", "b", "c"], "b", -4)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], "b", 2)).toEqual(["a", "b", "c"]);
    expect(moveInOrder(["a", "b"], "zzz", 1)).toEqual(["a", "b"]);
  });

  it("cleans a reason: trimmed, spaces collapsed, empty or too long is none", () => {
    expect(cleanReason("  Customer   deadline in Q1  ")).toBe("Customer deadline in Q1");
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason(undefined)).toBeNull();
    expect(cleanReason("x".repeat(REASON_MAX))).toHaveLength(REASON_MAX);
    expect(cleanReason("x".repeat(REASON_MAX + 1))).toBeNull();
  });
});

import { decisionText, toRankDecision } from "./rank-suggestion";
describe("what was decided (issue #397)", () => {
  it("reads a database row and writes the decision in words", () => {
    const d = toRankDecision({ session_id: "s", session_name: "Q1", applied_at: "2027-03-01T10:00:00Z", from_rank: "9", to_rank: 5, crowd_rank: 2, reason: "Contract date" });
    expect(d).toEqual({ sessionId: "s", sessionName: "Q1", appliedAt: "2027-03-01T10:00:00Z", fromRank: 9, toRank: 5, crowdRank: 2, reason: "Contract date" });
    expect(decisionText(d)).toBe("The vote suggested #2. Decided #5 (was #9).");
  });
});
