import { describe, expect, it } from "vitest";
import { applyMove, projectRanks, type RankItem } from "./rank";

const items = (n: number, project = (i: number) => (i % 2 ? "p1" : "p2")): RankItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i + 1}`, stack_rank: i + 1, home_project_id: project(i + 1) }));
const order = (xs: RankItem[]) => xs.map((x) => `${x.id}:${x.stack_rank}`).join(" ");

describe("projectRanks", () => {
  it("counts the order inside each project", () => {
    const r = projectRanks(items(6));
    expect(r.get("i1")).toBe(1); expect(r.get("i3")).toBe(2); expect(r.get("i5")).toBe(3);
    expect(r.get("i2")).toBe(1); expect(r.get("i4")).toBe(2); expect(r.get("i6")).toBe(3);
  });
  it("does not depend on the input order", () => {
    const shuffled = [...items(6)].reverse();
    expect(projectRanks(shuffled).get("i5")).toBe(3);
  });
});

describe("applyMove (mirrors move_item in the database)", () => {
  it("moves up and shifts the ones in between down", () => {
    expect(order(applyMove(items(5), "i4", 2).items)).toBe("i1:1 i4:2 i2:3 i3:4 i5:5");
  });
  it("moves down and shifts the ones in between up", () => {
    expect(order(applyMove(items(5), "i2", 4).items)).toBe("i1:1 i3:2 i4:3 i2:4 i5:5");
  });
  it("clamps to the list and reports the final position", () => {
    expect(applyMove(items(5), "i3", 99).to).toBe(5);
    expect(applyMove(items(5), "i3", -3).to).toBe(1);
    expect(applyMove(items(5), "i3", 3.7).to).toBe(4);
  });
  it("is a no-op when the position does not change", () => {
    const r = applyMove(items(5), "i3", 3);
    expect(r.changed).toBe(false);
    expect(order(r.items)).toBe(order(items(5)));
  });
  it("does not mutate its input and ignores unknown ids", () => {
    const input = items(3);
    const before = JSON.stringify(input);
    applyMove(input, "i2", 1);
    expect(JSON.stringify(input)).toBe(before);
    expect(applyMove(input, "nope", 1).changed).toBe(false);
  });
  it("keeps ranks dense and unique for random moves", () => {
    let xs = items(30);
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let k = 0; k < 200; k++) {
      xs = applyMove(xs, `i${1 + Math.floor(rnd() * 30)}`, 1 + Math.floor(rnd() * 32)).items;
      expect(xs.map((x) => x.stack_rank).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    }
  });
});
