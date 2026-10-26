import { describe, expect, it } from "vitest";
import { answersFor, cleanProgress, coinsLeft, duelKey, duelPairs, duelsDone, pickCount, rankingFromDuels, setCoins, type BallotItem } from "./alignment-ballot";

const items: BallotItem[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id.toUpperCase(), summary: null, value: null }));

describe("top 5 and duels", () => {
  it("picks five, or all when there are fewer", () => {
    expect(pickCount(12)).toBe(5);
    expect(pickCount(3)).toBe(3);
  });
  it("five picks give ten duels, three give three", () => {
    expect(duelPairs(["a", "b", "c", "d", "e"])).toHaveLength(10);
    expect(duelPairs(["a", "b", "c"])).toEqual([["a", "b"], ["a", "c"], ["b", "c"]]);
  });
  it("orders by duels won, and by pick order on equal wins", () => {
    const picks = ["a", "b", "c"];
    expect(rankingFromDuels(picks, { [duelKey("a", "b")]: "b", [duelKey("a", "c")]: "c", [duelKey("b", "c")]: "b" })).toEqual(["b", "c", "a"]);
    // a circle: everyone wins one, so the pick order stands
    expect(rankingFromDuels(picks, { [duelKey("a", "b")]: "a", [duelKey("a", "c")]: "c", [duelKey("b", "c")]: "b" })).toEqual(["a", "b", "c"]);
    expect(duelsDone(picks, {})).toBe(false);
  });
  it("is complete only with five picks and every duel decided", () => {
    const base = { picks: ["a", "b", "c", "d", "e"] };
    expect(answersFor("top5_duels", items, { picks: ["a", "b"] }, { coinsTotal: 100 })).toEqual({ ok: false, reason: "Pick 5 initiatives." });
    expect(answersFor("top5_duels", items, base, { coinsTotal: 100 })).toEqual({ ok: false, reason: "Finish the duels." });
    const duels = Object.fromEntries(duelPairs(base.picks).map(([a, b]) => [duelKey(a, b), a]));
    expect(answersFor("top5_duels", items, { ...base, duels }, { coinsTotal: 100 })).toEqual({ ok: true, answers: { ranking: ["a", "b", "c", "d", "e"] } });
  });
});

describe("coins", () => {
  it("never goes above the maximum per initiative, the total or below zero", () => {
    let c = setCoins(undefined, "a", 50, 100, 30);
    expect(c.a).toBe(30);
    c = setCoins(c, "b", 30, 100, 30);
    c = setCoins(c, "c", 30, 100, 30);
    c = setCoins(c, "d", 30, 100, 30);
    expect(c.d).toBe(10);
    expect(coinsLeft(c, 100)).toBe(0);
    expect(setCoins(c, "a", -5, 100, 30).a).toBe(0);
    expect(setCoins(c, "a", Number.NaN, 100, 30).a).toBe(0);
    // moving coins from a to e frees them first
    expect(setCoins(c, "a", 10, 100, 30).a).toBe(10);
  });
  it("is complete when every coin is spent", () => {
    const part = answersFor("coins", items.slice(0, 4), { coins: { a: 30, b: 30, c: 30 } }, { coinsTotal: 100 });
    expect(part).toEqual({ ok: false, reason: "Spend your last 10 coins." });
    const full = answersFor("coins", items.slice(0, 4), { coins: { a: 30, b: 30, c: 30, d: 10 } }, { coinsTotal: 100 });
    expect(full).toMatchObject({ ok: true });
  });
});

describe("ICE", () => {
  it("needs every initiative scored", () => {
    const two = items.slice(0, 2);
    expect(answersFor("ice", two, { ice: { a: { impact: 5, confidence: 5, ease: 5 } } }, { coinsTotal: 100 })).toEqual({ ok: false, reason: "Score 1 more initiative." });
    expect(answersFor("ice", two, { ice: { a: { impact: 5, confidence: 5, ease: 5 }, b: { impact: 1, confidence: 9, ease: 10 } } }, { coinsTotal: 100 })).toMatchObject({ ok: true });
  });
});

describe("cleanProgress", () => {
  it("drops what does not belong and survives garbage", () => {
    expect(cleanProgress(null, items)).toEqual({});
    expect(cleanProgress("x", items)).toEqual({});
    const c = cleanProgress({ picks: ["a", "a", "zzz", "b"], duels: { "a|b": "a", "a|zzz": "a", "a|b2": "q" }, coins: { a: 5, zzz: 9, b: -1 }, ice: { a: { impact: 11, confidence: 1, ease: 1 }, b: { impact: 3, confidence: 3, ease: 3 } }, step: "duels" }, items);
    expect(c.picks).toEqual(["a", "b"]);
    expect(c.duels).toEqual({ "a|b": "a" });
    expect(c.coins).toEqual({ a: 5 });
    expect(Object.keys(c.ice!)).toEqual(["b"]);
    expect(c.step).toBe("duels");
  });
});
