import { describe, expect, it } from "vitest";
import { BOARD_SELECTS, parseBoard, parseSelects, planBoardItem, DEFAULT_PRIORITY_MAP, type Board, type BoardMapping } from "./board";
import { BOARD_COLUMN, compareBoardValues, hashBoardValue } from "./board-compare";
import { OUTBOUND_READ_FIELDS } from "./outbound";
import type { BoardField } from "./source-control";

// Issue #513 (the GitHub twin of the Jira "Initiative fields"): Health, Initiative Status and Initiative Phase on single-select fields of the board.
const opts = (...n: string[]) => n.map((x, i) => ({ id: `o-${n.join("").length}-${i}`, name: x }));
const fields: BoardField[] = [
  { id: "fh", name: "Health", dataType: "SINGLE_SELECT", options: [{ id: "h1", name: "Green" }, { id: "h2", name: "Amber" }, { id: "h3", name: "Red" }] },
  { id: "fs", name: "Initiative state", dataType: "SINGLE_SELECT", options: [{ id: "s1", name: "Open" }, { id: "s2", name: "Paused" }] },
  { id: "fp", name: "Phase", dataType: "SINGLE_SELECT", options: [{ id: "p1", name: "Building" }, { id: "p2", name: "Testing" }] },
];
const selects: NonNullable<BoardMapping["selects"]> = {
  health: { field: { id: "fh", name: "Health" }, direction: "two_way", options: { "On Track": "Green", "At Risk": "Amber", Blocked: "Red" } },
  initiative_status: { field: { id: "fs", name: "Initiative state" }, direction: "two_way", options: { Active: "Open", "On hold": "Paused" } },
  initiative_phase: { field: { id: "fp", name: "Phase" }, direction: "to_github", options: { Build: "Building", Test: "Testing" } },
};
const mapping = (over: Partial<BoardMapping> = {}): BoardMapping => ({ priority: null, group: null, dueDate: null, size: null, status: null, priorityMap: { ...DEFAULT_PRIORITY_MAP }, selects, ...over });
const board = (m = mapping()): Board => ({ id: "B", number: 1, title: "Roadmap", url: "https://github.com/orgs/x/projects/1", mapping: m });

describe("the slots", () => {
  it("Initiative Phase has one direction, to GitHub; Health and Initiative Status have two", () => {
    expect(BOARD_SELECTS.map((s) => [s.key, s.directions.length])).toEqual([["health", 2], ["initiative_status", 2], ["initiative_phase", 1]]);
  });
  it("the three are readable for the board and nothing commercial is", () => {
    for (const k of ["health", "initiative_status", "initiative_phase"]) expect(OUTBOUND_READ_FIELDS as readonly string[]).toContain(k);
    for (const k of ["value_12m", "confidence", "decision", "cost_of_not_doing"]) expect(OUTBOUND_READ_FIELDS as readonly string[]).not.toContain(k);
  });
});

describe("planBoardItem writes the mapped options", () => {
  it("writes the option id of the board option each value stands for", () => {
    const p = planBoardItem({ moscow: "Must", health: "At Risk", initiative_status: "Active", initiative_phase: "Build" }, fields, mapping());
    expect(p.writes.map((w) => [w.field.id, w.value])).toEqual([["fh", { optionId: "h2" }], ["fs", { optionId: "s1" }], ["fp", { optionId: "p1" }]]);
  });
  it("a value with no option is not written and says so; an empty value writes nothing", () => {
    const p = planBoardItem({ health: "Delayed", initiative_status: "", initiative_phase: null }, fields, mapping());
    expect(p.writes).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/Health not sent.*Delayed/);
  });
  it("an option the board no longer has is not written, and a field the board no longer has is reported", () => {
    const m = mapping({ selects: { ...selects, health: { ...selects.health!, options: { "At Risk": "Purple" } } } });
    expect(planBoardItem({ health: "At Risk" }, fields, m).notes.join(" ")).toMatch(/no option "Purple"/);
    expect(planBoardItem({ health: "At Risk" }, [], mapping()).notes.join(" ")).toMatch(/no longer has a field "Health"/);
  });
  it("without a mapping nothing select-related is written", () => {
    expect(planBoardItem({ health: "At Risk", initiative_phase: "Build" }, fields, mapping({ selects: undefined })).writes).toEqual([]);
  });
  it("a Won't initiative still stays out of the board altogether", () => {
    expect(planBoardItem({ moscow: "Won't", health: "At Risk" }, fields, mapping()).include).toBe(false);
  });
});

describe("compareBoardValues for Health and Initiative Status", () => {
  const agreed = { health: hashBoardValue("Green"), initiative_status: hashBoardValue("Open") };
  const run = (values: Record<string, object>, pv: Record<string, string> = { health: "On Track", initiative_status: "Active" }, base: Record<string, string> | undefined = agreed, b = board()) =>
    compareBoardValues({ board: b, pv: pv as never, values: values as never, base: base as never, groups: [] });
  it("in step: both quiet", () => {
    expect(run({ fh: { option: "Green" }, fs: { option: "Open" } }).map((c) => c.verdict)).toEqual(["none", "none"]);
  });
  it("Health changed only on the board is a proposal; the PV value it stands for is what Keep GitHub would store", () => {
    const [c] = run({ fh: { option: "Red" }, fs: { option: "Open" } });
    expect(c).toMatchObject({ key: "health", label: "Health", verdict: "github", pvText: "Green", githubText: "Red", pull: { column: "health", value: "Blocked" } });
  });
  it("Initiative Status changed only on the board proposes the mapped value", () => {
    const c = run({ fh: { option: "Green" }, fs: { option: "Paused" } }).find((x) => x.key === "initiative_status")!;
    expect(c).toMatchObject({ verdict: "github", pull: { column: "initiative_status", value: "On hold" } });
  });
  it("only Product Velocity changed: it is sent, nothing to settle", () => {
    expect(run({ fh: { option: "Green" }, fs: { option: "Open" } }, { health: "At Risk", initiative_status: "Active" })[0]).toMatchObject({ verdict: "send" });
  });
  it("both changed: no default", () => {
    expect(run({ fh: { option: "Red" }, fs: { option: "Open" } }, { health: "At Risk", initiative_status: "Active" })[0]).toMatchObject({ verdict: "both" });
  });
  it("a board option that stands for no value cannot be taken over, with a note", () => {
    const m = mapping({ selects: { ...selects, health: { ...selects.health!, options: { "On Track": "Green" } } } });
    const [c] = run({ fh: { option: "Red" } }, { health: "On Track" }, agreed, board(m));
    expect(c!.pull).toBeNull();
    expect(c!.pullNote).toMatch(/not an option/);
  });
  it("a slot set to to_github, Initiative Phase and an unmapped slot are never compared (nothing comes back)", () => {
    const m = mapping({ selects: { ...selects, health: { ...selects.health!, direction: "to_github" } } });
    const keys = run({ fh: { option: "Red" }, fs: { option: "Open" }, fp: { option: "Testing" } }, { health: "On Track", initiative_status: "Active", initiative_phase: "Build" }, agreed, board(m)).map((c) => c.key);
    expect(keys).toEqual(["initiative_status"]);
    expect(run({ fh: { option: "Red" } }, {}, agreed, board(mapping({ selects: undefined })))).toEqual([]);
  });
  it("the item columns a pull may write are exactly health and initiative_status here, never the phase", () => {
    expect(BOARD_COLUMN.health).toBe("health");
    expect(BOARD_COLUMN.initiative_status).toBe("initiative_status");
    expect(Object.values(BOARD_COLUMN)).not.toContain("initiative_phase");
  });
});

describe("parseBoard keeps and cleans the select mapping", () => {
  const stored = { id: "B", number: 1, title: "Roadmap", url: "https://github.com/orgs/x/projects/1", mapping: { priority: null, group: null, dueDate: null, size: null, status: null, priorityMap: DEFAULT_PRIORITY_MAP, selects } };
  it("round-trips a good mapping", () => { expect(parseBoard(stored)!.mapping.selects).toEqual(selects); });
  it("forces Initiative Phase to_github, drops two values on one option for a two-way slot, and drops rubbish", () => {
    const p = parseSelects({ initiative_phase: { field: { id: "fp", name: "Phase" }, direction: "two_way", options: { Build: "Building" } }, health: { field: { id: "fh", name: "Health" }, direction: "two_way", options: { "On Track": "Green", "At Risk": "green" } }, initiative_status: { field: "x", direction: "two_way", options: {} }, value_12m: { field: { id: "a", name: "b" }, direction: "to_github", options: {} } })!;
    expect(p.initiative_phase!.direction).toBe("to_github");
    expect(p.health!.options).toEqual({ "On Track": "Green" });
    expect(p.initiative_status).toBeUndefined();
    expect(Object.keys(p)).not.toContain("value_12m");
    expect(parseSelects(null)).toBeUndefined();
    expect(parseSelects("x")).toBeUndefined();
  });
  it("a board stored before this change still parses, with no selects", () => {
    expect(parseBoard({ ...stored, mapping: { ...stored.mapping, selects: undefined } })!.mapping.selects).toBeUndefined();
  });
});
