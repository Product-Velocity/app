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
