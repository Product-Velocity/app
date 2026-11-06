import { describe, expect, it } from "vitest";
import { detectMapping } from "./board";
import { MemorySourceControl } from "./memory-source";
import { planReadyBoard, writeReadyStatus, type ReadyInput } from "./ready";
import type { BoardField } from "./source-control";

const status = (names: string[]): BoardField => ({ id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: names.map((n, i) => ({ id: `o${i}`, name: n })) });
const base = (fields: BoardField[], over: Partial<ReadyInput> = {}): ReadyInput => ({ ready: true, mode: "push", handled: false, fields, mapping: detectMapping(fields), current: null, ...over });

describe("planReadyBoard", () => {
  const f = [status(["Backlog", "Ready", "In progress", "Done"])];
  it("sets Ready when Status is empty or Backlog", () => {
    expect(planReadyBoard(base(f))).toMatchObject({ state: "set", text: "Set Status to Ready", optionId: "o1" });
    expect(planReadyBoard(base(f, { current: "Backlog" }))).toMatchObject({ state: "set" });
    expect(planReadyBoard(base(f, { current: " backlog " }))).toMatchObject({ state: "set" });
  });
  it("never moves an item that is further along, or already Ready", () => {
    for (const c of ["In progress", "Done", "In review"]) expect(planReadyBoard(base(f, { current: c })).state).toBe("ahead");
    expect(planReadyBoard(base(f, { current: "Ready" })).state).toBe("already");
  });
  it("does nothing when not ready for build, followed, handled, frozen or without a board", () => {
    for (const o of [{ ready: false }, { mode: "follow" as const }, { handled: true }, { frozen: true }, { mapping: null }]) expect(planReadyBoard(base(f, o)).state).toBe("none");
  });
  it("a board without a Ready option says add it in GitHub and writes nothing", () => {
    const p = planReadyBoard(base([status(["Backlog", "Done"])]));
    expect(p.state).toBe("blocked");
    expect(p.state === "blocked" && p.text).toMatch(/add Ready in GitHub/);
  });
  it("a board that cannot be read, or has no single-select Status, is blocked", () => {
    expect(planReadyBoard(base(f, { fields: null })).state).toBe("blocked");
    expect(planReadyBoard(base([{ id: "x", name: "Status", dataType: "TEXT" }])).state).toBe("blocked");
  });
});

describe("writeReadyStatus", () => {
  const plan = { state: "set" as const, text: "Set Status to Ready", field: { id: "F_status", name: "Status" }, optionId: "o1" };
  const fake = (current: string | null, calls: unknown[]) => ({
    getBoardItemValues: async () => (current === null ? {} : { F_status: { option: current } }),
    setBoardValue: async (...a: unknown[]) => { calls.push(a); },
  }) as unknown as MemorySourceControl;
  it("writes exactly the Ready option while Status is still at the start", async () => {
    const calls: unknown[] = [];
    expect(await writeReadyStatus(fake(null, calls), 1, "B", "I", plan)).toEqual({ ok: true, result: "set", status: "Ready" });
    expect(calls).toEqual([[1, "B", "I", "F_status", { optionId: "o1" }]]);
  });
  it("reads again and writes nothing when the item moved since the preview", async () => {
    const calls: unknown[] = [];
    expect(await writeReadyStatus(fake("In progress", calls), 1, "B", "I", plan)).toMatchObject({ ok: true, result: "already_ahead" });
    expect(await writeReadyStatus(fake("Done", calls), 1, "B", "I", plan)).toMatchObject({ ok: true, result: "already_ahead" });
    expect(calls).toEqual([]);
  });
  it("a refusal is returned as a short message", async () => {
    const sc = { getBoardItemValues: async () => ({}), setBoardValue: async () => { throw new Error("x"); } } as unknown as MemorySourceControl;
    expect(await writeReadyStatus(sc, 1, "B", "I", plan)).toEqual({ ok: false, message: "GitHub could not be reached." });
  });
});
