import { describe, expect, it } from "vitest";
import type { BoardField } from "@pv/github";
import { BSEL_DIR, BSEL_FIELD, BSEL_OPT, boardSelectsFromForm, validateBoardSelects } from "./board-selects-form";

const fields: BoardField[] = [
  { id: "fh", name: "Health", dataType: "SINGLE_SELECT", options: [{ id: "1", name: "Green" }, { id: "2", name: "Amber" }] },
  { id: "fs", name: "State", dataType: "SINGLE_SELECT", options: [{ id: "3", name: "Open" }] },
  { id: "fn", name: "Notes", dataType: "TEXT" },
];
const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";

describe("boardSelectsFromForm", () => {
  it("builds a slot per chosen field with its options by name; an empty field leaves the slot unmapped", () => {
    const m = boardSelectsFromForm(form({ [BSEL_FIELD("health")]: "fh", [BSEL_DIR("health")]: "two_way", [BSEL_OPT("health", "On Track")]: "Green", [BSEL_OPT("health", "At Risk")]: "" }), fields);
    expect(m).toEqual({ health: { field: { id: "fh", name: "Health" }, direction: "two_way", options: { "On Track": "Green" } } });
    expect(boardSelectsFromForm(form({}), fields)).toBeUndefined();
  });
  it("Initiative Phase is always to GitHub, and a field that is not on the board is dropped", () => {
    const m = boardSelectsFromForm(form({ [BSEL_FIELD("initiative_phase")]: "fs", [BSEL_DIR("initiative_phase")]: "two_way", [BSEL_OPT("initiative_phase", "Build")]: "Open", [BSEL_FIELD("health")]: "nope" }), fields)!;
    expect(m.initiative_phase!.direction).toBe("to_github");
    expect(m.health).toBeUndefined();
  });
});

describe("validateBoardSelects", () => {
  const ok = { health: { field: { id: "fh", name: "Health" }, direction: "two_way" as const, options: { "On Track": "green" } } };
  it("accepts a good mapping (option names are matched without regard to case)", () => { expect(validateBoardSelects(ok, fields)).toEqual([]); });
  it("refuses a field that is not a single select, an option the field lacks, and one field used twice", () => {
    expect(validateBoardSelects({ health: { field: { id: "fn", name: "Notes" }, direction: "to_github", options: {} } }, fields)[0]).toMatch(/not a single-select/);
    expect(validateBoardSelects({ health: { ...ok.health, options: { "On Track": "Purple" } } }, fields).join(" ")).toMatch(/no option “Purple”/);
    expect(validateBoardSelects({ ...ok, initiative_status: { field: { id: "fh", name: "Health" }, direction: "to_github", options: {} } }, fields).join(" ")).toMatch(/already used/);
  });
  it("a field the board's other mapping uses is already taken", () => {
    expect(validateBoardSelects(ok, fields, ["fh"]).join(" ")).toMatch(/already used/);
  });
});
