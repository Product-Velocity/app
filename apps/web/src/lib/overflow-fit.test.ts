import { describe, expect, it } from "vitest";
import { fitItems, type FitItem } from "./overflow-fit";

const it3 = (over: Partial<FitItem>[] = []): FitItem[] =>
  ["a", "b", "c"].map((id, i) => ({ id, width: 100, rank: i, ...(over[i] ?? {}) }));

describe("fitItems", () => {
  it("keeps everything when it fits, with no room kept for More", () => {
    expect(fitItems({ items: it3(), available: 320, moreWidth: 40, gap: 10 })).toEqual([]);
  });
  it("moves the highest rank first and keeps room for the More button", () => {
    // 3 x 100 + 2 gaps = 320 > 300; room is 300 - 40 - 10 = 250, so c goes (210 fits)
    expect(fitItems({ items: it3(), available: 300, moreWidth: 40, gap: 10 })).toEqual(["c"]);
  });
  it("keeps going until the rest fits next to the button", () => {
    expect(fitItems({ items: it3(), available: 150, moreWidth: 40, gap: 10 })).toEqual(["c", "b"]);
  });
  it("never moves a pinned item, even when nothing else is left", () => {
    expect(fitItems({ items: it3([{ pinned: true, rank: 9 }]), available: 50, moreWidth: 40, gap: 10 })).toEqual(["c", "b"]);
  });
  it("on equal rank moves the one furthest right first", () => {
    expect(fitItems({ items: it3([{ rank: 1 }, { rank: 1 }, { rank: 1 }]), available: 300, moreWidth: 40, gap: 10 })).toEqual(["c"]);
  });
  it("handles an empty bar", () => {
    expect(fitItems({ items: [], available: 0, moreWidth: 40, gap: 10 })).toEqual([]);
  });
});
