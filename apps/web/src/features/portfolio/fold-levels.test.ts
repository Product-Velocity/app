import { describe, expect, it } from "vitest";
import { describeNext, levelsOfKeys, nextFold, type Direction, type FoldLevel } from "./fold-levels";

const lv = (...counts: number[]): FoldLevel[] => counts.map((n, i) => ({ name: `L${i + 1}`, keys: Array.from({ length: n }, (_, k) => `l${i + 1}:${k}`) }));
/** Presses the button `times` and returns what each press did, as "collapse 3" / "expand 1". */
function press(levels: FoldLevel[], times: number, start: { collapsed?: Set<string>; direction?: Direction } = {}) {
  let collapsed = start.collapsed ?? new Set<string>();
  let direction: Direction = start.direction ?? "close";
  const done: string[] = [];
  for (let i = 0; i < times; i++) {
    const s = nextFold(levels, collapsed, direction)!;
    done.push(`${s.action} ${s.level}`);
    collapsed = s.next;
    direction = s.direction;
  }
  return { done, collapsed, direction };
}

describe("the fold button steps through the levels, then reverses", () => {
  it("two levels: close the second, close the first, open the first, open the second, and again", () => {
    expect(press(lv(2, 3), 8).done).toEqual(["collapse 2", "collapse 1", "expand 1", "expand 2", "collapse 2", "collapse 1", "expand 1", "expand 2"]);
  });
  it("three levels: the deepest first up to the top, then the top first down to the deepest", () => {
    expect(press(lv(2, 3, 4), 7).done).toEqual(["collapse 3", "collapse 2", "collapse 1", "expand 1", "expand 2", "expand 3", "collapse 3"]);
  });
  it("four levels", () => {
    expect(press(lv(1, 1, 1, 1), 8).done).toEqual(["collapse 4", "collapse 3", "collapse 2", "collapse 1", "expand 1", "expand 2", "expand 3", "expand 4"]);
  });
  it("one level: it just toggles", () => {
    expect(press(lv(3), 4).done).toEqual(["collapse 1", "expand 1", "collapse 1", "expand 1"]);
  });
  it("the state after each press is what the person sees: after expanding the first level the deeper ones are still folded", () => {
    const r = press(lv(2, 2), 3); // collapse 2, collapse 1, expand 1
    expect([...r.collapsed].sort()).toEqual(["l2:0", "l2:1"]);
  });
  it("levels without keys are skipped (no issues under any initiative)", () => {
    expect(press([...lv(2), { name: "issues", keys: [] }], 3).done).toEqual(["collapse 1", "expand 1", "collapse 1"]);
  });
  it("nothing to fold: no step", () => {
    expect(nextFold([], new Set(), "close")).toBeNull();
    expect(nextFold([{ name: "x", keys: [] }], new Set(), "close")).toBeNull();
  });
  it("copes with what was folded by hand in between: closing takes the deepest level not fully folded", () => {
    const levels = lv(2, 2);
    const hand = new Set(["l2:0"]); // one second-level group folded by hand
    expect(nextFold(levels, hand, "close")).toMatchObject({ action: "collapse", level: 2 });
    expect(nextFold(levels, new Set(["l2:0", "l2:1"]), "close")).toMatchObject({ action: "collapse", level: 1 });
  });
  it("opening takes the first level that has anything folded, also a partly folded one", () => {
    const levels = lv(2, 2);
    expect(nextFold(levels, new Set(["l1:0"]), "open")).toMatchObject({ action: "expand", level: 1 });
  });
  it("turns round at the ends even when the direction was left pointing the wrong way", () => {
    const levels = lv(2, 2);
    expect(nextFold(levels, new Set(), "open")).toMatchObject({ action: "collapse", level: 2, direction: "close" });
    expect(nextFold(levels, new Set(["l1:0", "l1:1", "l2:0", "l2:1"]), "close")).toMatchObject({ action: "expand", level: 1, direction: "open" });
  });
});

describe("the label says what the next press does", () => {
  it("names the level and the step", () => {
    const l = lv(2, 3);
    expect(describeNext(l, new Set(), "close")).toMatchObject({ label: "Collapse level 2 (L2)", title: expect.stringContaining("step 1 of 4") });
    expect(describeNext(l, new Set(["l1:0", "l1:1", "l2:0", "l2:1", "l2:2"]), "open")).toMatchObject({ label: "Expand level 1 (L1)", title: expect.stringContaining("step 3 of 4") });
  });
  it("one level keeps the old wording", () => {
    expect(describeNext(lv(2), new Set(), "close")).toMatchObject({ label: "Collapse all L1" });
    expect(describeNext(lv(2), new Set(["l1:0", "l1:1"]), "open")).toMatchObject({ label: "Expand all L1" });
  });
  it("is null with nothing to fold", () => {
    expect(describeNext([], new Set(), "close")).toBeNull();
  });
});

describe("levelsOfKeys: the depth of a group is the number of > in its key", () => {
  it("splits the groups of a Group by and a Then by", () => {
    const levels = levelsOfKeys(["phase:A", "phase:B", "phase:A>health:Red", "phase:A>health:Green"]);
    expect(levels.map((l) => [l.name, l.keys.length])).toEqual([["groups", 2], ["sub-groups", 2]]);
  });
  it("is one level when there is no Then by", () => {
    expect(levelsOfKeys(["phase:A", "phase:B"]).map((l) => l.keys.length)).toEqual([2]);
  });
});
