import { describe, expect, it } from "vitest";
import { scoreSession, voteValue, place, type BallotInput } from "./alignment-scoring";

const items = ["x", "y", "z"];
const many = (group: string, n: number, coins: [number, number, number]): BallotInput[] =>
  Array.from({ length: n }, () => ({ group, votes: { x: { coins: coins[0] }, y: { coins: coins[1] }, z: { coins: coins[2] } } }));
const groups = [{ id: "a", name: "Sales" }, { id: "b", name: "Engineering" }, { id: "c", name: "Support" }];
const score = (r: ReturnType<typeof scoreSession>, id: string) => r.joint.find((p) => p.itemId === id)!.score;

// The worked example of docs/02 (100 coins): Sales 5 voters 30/20/10, Engineering 5 voters 10/30/30, Support 4 voters 0/0/30.
describe("100 coins, the worked example", () => {
  const ballots = [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 4, [0, 0, 30])];
  const base = { method: "coins" as const, itemIds: items, ballots, groups, excluded: [] };

  it("equal weights: group scores are scaled to 100, averaged and scaled again", () => {
    const r = scoreSession({ ...base, weighting: "equal" });
    // x: (100 + 33.33 + 0) / 3 = 44.44, y: (66.67 + 100 + 0) / 3 = 55.56, z: (33.33 + 100 + 100) / 3 = 77.78; scaled so z = 100
    expect(score(r, "z")).toBe(100);
    expect(score(r, "y")).toBeCloseTo(71.43, 2);
    expect(score(r, "x")).toBeCloseTo(57.14, 2);
    expect(r.joint.map((p) => p.itemId)).toEqual(["z", "y", "x"]);
    expect(r.voters).toBe(14);
  });
  it("headcount weights: bigger groups count more", () => {
    const r = scoreSession({ ...base, weighting: "headcount" });
    expect(score(r, "y")).toBeCloseTo(78.125, 1);
    expect(score(r, "x")).toBeCloseTo(62.5, 2);
  });
  it("a group the admin leaves out does not count in the joint score", () => {
    const r = scoreSession({ ...base, weighting: "equal", excluded: ["c"] });
    // only Sales and Engineering: x (100+33.33)/2 = 66.67, y 83.33, z 66.67 -> y = 100
    expect(score(r, "y")).toBe(100);
    expect(score(r, "x")).toBeCloseTo(80, 2);
    expect(score(r, "z")).toBeCloseTo(80, 2);
    expect(r.joint.find((p) => p.itemId === "x")!.tied).toBe(true);
  });
  it("a group of 4 is hidden (and so are all groups, to stop subtraction); the joint still counts it", () => {
    const r = scoreSession({ ...base, weighting: "equal" });
    expect(r.groups).toBeNull();
    expect(r.groupsNote).toMatch(/fewer than 5/);
    expect(r.contested).toEqual([]);
  });
  it("a group of 5 is shown, with its own scores and places", () => {
    const r = scoreSession({ ...base, ballots: [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 5, [0, 0, 30])], weighting: "equal" });
    expect(r.groups!.map((g) => [g.name, g.voters])).toEqual([["Sales", 5], ["Engineering", 5], ["Support", 5]]);
    const sales = r.groups!.find((g) => g.id === "a")!;
    expect(sales.scores.find((s) => s.itemId === "y")!.score).toBeCloseTo(66.67, 2);
    expect(sales.scores[0]).toMatchObject({ itemId: "x", place: 1, score: 100 });
  });
  it("small groups merge into Other, shown only at 5 or more voters together", () => {
    const small = [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 3, [0, 0, 30]), ...many("d", 2, [0, 30, 0])];
    const withOther = scoreSession({ ...base, ballots: small, groups: [...groups, { id: "d", name: "Partners" }], weighting: "equal" });
    expect(withOther.groups!.map((g) => [g.name, g.voters])).toEqual([["Sales", 5], ["Engineering", 5], ["Other", 5]]);
    const tooFew = scoreSession({ ...base, ballots: [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 2, [0, 0, 30]), ...many("d", 2, [0, 30, 0])], groups: [...groups, { id: "d", name: "Partners" }], weighting: "equal" });
    expect(tooFew.groups).toBeNull();
  });
  it("flags the initiatives the groups disagree about, with who is for and who against", () => {
    const r = scoreSession({ ...base, ballots: [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 5, [0, 0, 30])], weighting: "equal" });
    const x = r.contested.find((c) => c.itemId === "x")!;
    expect(x).toMatchObject({ highGroup: "Sales", lowGroup: "Support", spread: 100 });
    expect(r.contested[0]!.spread).toBeGreaterThanOrEqual(r.contested.at(-1)!.spread);
  });
});

describe("top 5 with duels and ICE", () => {
  it("places count for top 5: first of five is worth 5, not picked 0", () => {
    expect(voteValue("top5_duels", { rank: 1 }, 5)).toBe(5);
    expect(voteValue("top5_duels", { rank: 5 }, 5)).toBe(1);
    expect(voteValue("top5_duels", { rank: null }, 5)).toBe(0);
    expect(voteValue("top5_duels", { rank: 1 }, 3)).toBe(3);
    const ballots: BallotInput[] = [
      ...Array.from({ length: 5 }, () => ({ group: "a", votes: { x: { rank: 1 }, y: { rank: 2 }, z: { rank: null } } })),
    ];
    const r = scoreSession({ method: "top5_duels", itemIds: items, ballots, groups, weighting: "equal", excluded: [] });
    expect(r.joint.map((p) => [p.itemId, p.score])).toEqual([["x", 100], ["y", 66.67], ["z", 0]]);
  });
  it("ICE multiplies impact, confidence and ease", () => {
    expect(voteValue("ice", { impact: 8, confidence: 5, ease: 2 }, 3)).toBe(80);
    const ballots: BallotInput[] = Array.from({ length: 5 }, () => ({ group: "a", votes: { x: { impact: 10, confidence: 10, ease: 10 }, y: { impact: 5, confidence: 10, ease: 10 }, z: { impact: 1, confidence: 1, ease: 1 } } }));
    const r = scoreSession({ method: "ice", itemIds: items, ballots, groups, weighting: "equal", excluded: [] });
    expect(r.joint.map((p) => p.itemId)).toEqual(["x", "y", "z"]);
    expect(r.joint[1]!.score).toBe(50);
  });
});

describe("ties and empty sessions", () => {
  it("equal scores share a place and are marked tied; the next place skips", () => {
    const p = place(["a", "b", "c", "d"], [80, 80, 100, 10]);
    expect(p.map((x) => [x.itemId, x.place, x.tied])).toEqual([["c", 1, false], ["a", 2, true], ["b", 2, true], ["d", 4, false]]);
  });
  it("ties keep the order of the session, so the same votes always give the same list", () => {
    const a = place(["a", "b"], [50, 50]).map((x) => x.itemId);
    expect(a).toEqual(["a", "b"]);
  });
  it("nobody voted: everything is zero and tied", () => {
    const r = scoreSession({ method: "coins", itemIds: items, ballots: [], groups, weighting: "equal", excluded: [] });
    expect(r.voters).toBe(0);
    expect(r.joint.every((p) => p.score === 0 && p.place === 1 && p.tied)).toBe(true);
    expect(r.groups).toBeNull();
  });
});

describe("what the result may contain", () => {
  it("never names, counts or scores a group under the threshold, however it is serialised", () => {
    const small = [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 4, [0, 0, 30])];
    const withOther = scoreSession({ method: "coins", itemIds: items, ballots: small, groups: [...groups, { id: "d", name: "Partners" }], weighting: "equal", excluded: [] });
    expect(withOther.groups).toBeNull();
    expect(JSON.stringify(withOther)).not.toMatch(/Support|Partners/);
    const merged = scoreSession({ method: "coins", itemIds: items, ballots: [...many("a", 5, [30, 20, 10]), ...many("b", 5, [10, 30, 30]), ...many("c", 3, [0, 0, 30]), ...many("d", 2, [0, 30, 0])], groups: [...groups, { id: "d", name: "Partners" }], weighting: "equal", excluded: [] });
    expect(JSON.stringify(merged)).not.toMatch(/Support|Partners/);
    expect(merged.groups!.map((g) => g.name)).toEqual(["Sales", "Engineering", "Other"]);
    expect(merged.groups!.every((g) => g.voters >= 5)).toBe(true);
  });
});
