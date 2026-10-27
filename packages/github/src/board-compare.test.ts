import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORITY_MAP, type Board } from "./board";
import { BOARD_COLUMN, compareBoardValues as compareAll, hashBoardValue, isBoardConflict } from "./board-compare";
const compareBoardValues = (i: Parameters<typeof compareAll>[0]) => compareAll(i).filter(isBoardConflict); // the values a person must settle

const f = (id: string) => ({ id, name: id });
const board = (over: Partial<Board["mapping"]> = {}): Board => ({ id: "B", number: 1, title: "Roadmap", url: "https://github.com/orgs/x/projects/1", mapping: { priority: f("fp"), group: f("fg"), dueDate: f("fd"), size: f("fs"), status: f("fst"), priorityMap: { ...DEFAULT_PRIORITY_MAP }, ...over } });
const pv = { moscow: "Must", theme: "Mobile", end_date: "2026-12-31", effort: "M" };
const same = { fp: { option: "P0" }, fg: { option: "Mobile" }, fd: { date: "2026-12-31" }, fs: { option: "M" } };
const base = (p = pv) => ({ priority: hashBoardValue("P0"), group: hashBoardValue(p.theme), due: hashBoardValue(p.end_date), size: hashBoardValue(p.effort) });
const run = (over: { pv?: typeof pv | Record<string, unknown>; values?: Record<string, object>; base?: ReturnType<typeof base> | undefined; board?: Board; groups?: string[] }) =>
  compareBoardValues({ board: over.board ?? board(), pv: (over.pv ?? pv) as never, values: { ...same, ...(over.values ?? {}) } as never, base: "base" in over ? over.base : base(), groups: over.groups ?? ["Mobile", "Platform"] });

describe("compareBoardValues", () => {
  it("every compared value is reported with its verdict, so the agreement can be recorded", () => {
    const all = compareAll({ board: board(), pv, values: same as never, base: base(), groups: [] });
    expect(all.map((c) => [c.key, c.verdict])).toEqual([["priority", "none"], ["group", "none"], ["due", "none"], ["size", "none"]]);
    const sent = compareAll({ board: board(), pv: { ...pv, effort: "L" }, values: same as never, base: base(), groups: [] });
    expect(sent.find((c) => c.key === "size")).toMatchObject({ verdict: "send", pvText: "L", githubText: "M" });
  });
  it("without a base, Product Velocity unchanged since the last send counts as the agreed value", () => {
    const [c] = run({ base: undefined, values: { fp: { option: "P1" } } });
    expect(c!.verdict).toBe("both");
    const [d] = compareAll({ board: board(), pv, values: { ...same, fp: { option: "P1" } } as never, pvUnchanged: true, groups: [] }).filter(isBoardConflict);
    expect(d!.verdict).toBe("github");
  });
  it("is quiet when the board shows what Product Velocity would write", () => expect(run({})).toEqual([]));

  it("a Priority changed only on the board is a one-sided difference with Keep Product Velocity as the natural default", () => {
    const [c] = run({ values: { fp: { option: "P1" } } });
    expect(c).toMatchObject({ key: "priority", verdict: "github", pvText: "P0", githubText: "P1", pull: { column: "moscow", value: "Should" } });
  });
  it("changed on both sides: a conflict with no side preferred", () => {
    const [c] = run({ pv: { ...pv, moscow: "Should" }, values: { fp: { option: "P2" } } });
    expect(c).toMatchObject({ key: "priority", verdict: "both", pvText: "P1", githubText: "P2", pull: { column: "moscow", value: "Could" } });
  });
  it("only Product Velocity changed: not a conflict (the send writes it)", () => expect(run({ pv: { ...pv, effort: "L" } })).toEqual([]));
  it("dates, sizes and groups are compared and mapped back to their columns", () => {
    const r = run({ values: { fd: { date: "2027-01-15" }, fs: { option: "xl" }, fg: { option: "platform" } } });
    expect(r.map((c) => [c.key, c.pull])).toEqual([["group", { column: "theme", value: "Platform" }], ["due", { column: "end_date", value: "2027-01-15" }], ["size", { column: "effort", value: "XL" }]]);
    expect(Object.values(BOARD_COLUMN).sort()).toEqual(["effort", "end_date", "moscow", "theme"]);
  });
  it("a board value Product Velocity cannot take over is shown, with the reason, and offers no pull", () => {
    const r = run({ values: { fp: { option: "P3" }, fg: { option: "Brand new" }, fd: { text: "next week" }, fs: { option: "XXL" } } });
    expect(r.every((c) => c.pull === null && !!c.pullNote)).toBe(true);
    expect(r.find((c) => c.key === "group")!.pullNote).toMatch(/nothing is created/);
  });
  it("an empty Product Velocity value with the board filled is offered the board's value", () => {
    const [c] = run({ pv: { ...pv, effort: null }, values: { fs: { option: "S" } } });
    expect(c).toMatchObject({ key: "size", verdict: "github", pvText: "", pull: { column: "effort", value: "S" } });
  });
  it("without a stored base any difference is a conflict, never a silent overwrite", () => {
    expect(run({ base: undefined, values: { fp: { option: "P1" } } })[0]!.verdict).toBe("both");
  });
  it("never compares what the board has empty, a field the board lacks, an issue field, or a Won't initiative", () => {
    expect(run({ values: { fp: {}, fg: {}, fd: {}, fs: {} } })).toEqual([]);
    expect(run({ board: board({ priority: null, size: null }), values: { fp: { option: "P2" }, fs: { option: "XL" } } })).toEqual([]);
    expect(run({ board: board({ unwritable: ["fd"] }), values: { fd: { date: "2030-01-01" } } })).toEqual([]);
    expect(run({ pv: { ...pv, moscow: "Won't" }, values: { fp: { option: "P2" } } })).toEqual([]);
  });
  it("a hostile value only ever lands in its own column, as text, or is refused", () => {
    const evil = "P0\n'; update items set value_12m = 1; --";
    const [c] = run({ values: { fp: { option: evil } } });
    expect(c!.pull).toBeNull();
    expect(JSON.stringify(run({ values: { fg: { text: "Mobile; drop table items" } } }))).not.toContain('"column":"value');
  });
});
