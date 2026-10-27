import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORITY_MAP, detectMapping, MemorySourceControl, parseBoard, planBoardItem, pushBoardItem, type BoardField } from "./index";

const opts = (...names: string[]) => names.map((name, i) => ({ id: `o-${name}`, name, i }));
// the board in Ashu's example: Priority, Status, Initiative (single selects), Due date, Size, plus fields PV never writes
const fields: BoardField[] = [
  { id: "f-title", name: "Title", dataType: "OTHER" },
  { id: "f-prio", name: "Priority", dataType: "SINGLE_SELECT", options: opts("P0", "P1", "P2", "P3") },
  { id: "f-status", name: "Status", dataType: "SINGLE_SELECT", options: opts("New", "In progress", "Done") },
  { id: "f-init", name: "Initiative", dataType: "SINGLE_SELECT", options: opts("Growth", "Reporting") },
  { id: "f-due", name: "Due date", dataType: "DATE" },
  { id: "f-size", name: "Size", dataType: "SINGLE_SELECT", options: opts("XS", "S", "M", "L", "XL") },
  { id: "f-assign", name: "Assignees", dataType: "OTHER" },
];
const mapping = detectMapping(fields);
const item = { moscow: "Should", theme: "Growth", end_date: "2026-12-15", effort: "M" };

describe("detectMapping finds the board's own fields by their usual names", () => {
  it("maps Priority, Initiative, Due date, Size and Status, and ignores everything else", () => {
    expect(mapping).toMatchObject({
      priority: { id: "f-prio", name: "Priority" }, group: { id: "f-init", name: "Initiative" }, dueDate: { id: "f-due", name: "Due date" },
      size: { id: "f-size", name: "Size" }, status: { id: "f-status", name: "Status" },
    });
    expect(mapping.priorityMap).toEqual(DEFAULT_PRIORITY_MAP);
  });
  it("also knows the other usual names, ignores case, and leaves a missing field unmapped", () => {
    const m = detectMapping([{ id: "a", name: "initiative group", dataType: "TEXT" }, { id: "b", name: "Target date", dataType: "DATE" }, { id: "c", name: "priority", dataType: "TEXT" }]);
    expect(m.group?.id).toBe("a");
    expect(m.dueDate?.id).toBe("b");
    expect(m.priority).toBeNull(); // a Priority that is not a single select cannot hold P0..P3
    expect(m.size).toBeNull();
    expect(m.status).toBeNull();
  });
  it("MoSCoW becomes P0 to P2; Won't has no priority and stays out of the board", () => {
    expect(DEFAULT_PRIORITY_MAP).toEqual({ Must: "P0", Should: "P1", Could: "P2" });
  });
});

describe("planBoardItem", () => {
  it("writes Priority from MoSCoW, the group, the due date from the G2M date and Size from the effort estimate", () => {
    const p = planBoardItem(item, fields, mapping);
    expect(p.include).toBe(true);
    expect(p.notes).toEqual([]);
    expect(p.writes.map((w) => [w.field.name, w.value])).toEqual([
      ["Priority", { optionId: "o-P1" }], ["Initiative", { optionId: "o-Growth" }], ["Due date", { date: "2026-12-15" }], ["Size", { optionId: "o-M" }],
    ]);
    expect(p.writes.map((w) => w.label)).toEqual(["P1", "Growth", "2026-12-15", "M"]);
  });
  it("a Won't initiative stays in Product Velocity: not on the board, nothing written", () => {
    const p = planBoardItem({ ...item, moscow: "Won't" }, fields, mapping);
    expect(p.include).toBe(false);
    expect(p.writes).toEqual([]);
    expect(p.notes[0]).toContain("stay in Product Velocity");
  });
  it("Won't stays out of the board even when the board has no Priority field", () => {
    expect(planBoardItem({ ...item, moscow: "Won't" }, fields.filter((f) => f.id !== "f-prio"), { ...mapping, priority: null }).include).toBe(false);
  });
  it("without MoSCoW the initiative is still on the board, just without a priority", () => {
    const p = planBoardItem({ ...item, moscow: null }, fields, mapping);
    expect(p.include).toBe(true);
    expect(p.writes.map((w) => w.field.name)).not.toContain("Priority");
  });
  it("empty values are not written: nothing already on the board is cleared", () => {
    const p = planBoardItem({ moscow: "Must" }, fields, mapping);
    expect(p.writes.map((w) => w.field.name)).toEqual(["Priority"]);
  });
  it("an option the board does not have is reported, never created, and nothing else is lost", () => {
    const p = planBoardItem({ ...item, theme: "Payments", effort: "XL" }, fields.map((f) => (f.id === "f-prio" ? { ...f, options: opts("P0", "P2") } : f)), mapping);
    expect(p.writes.map((w) => w.field.name)).toEqual(["Due date", "Size"]);
    expect(p.notes.join(" ")).toContain('"Priority" has no option "P1"');
    expect(p.notes.join(" ")).toContain('"Initiative" has no option "Payments"');
  });
  it("a text field takes the group as text, and a field that was deleted on GitHub is reported", () => {
    const text = fields.map((f) => (f.id === "f-init" ? { id: "f-init", name: "Initiative", dataType: "TEXT" as const } : f));
    expect(planBoardItem(item, text, mapping).writes.find((w) => w.field.name === "Initiative")?.value).toEqual({ text: "Growth" });
    const gone = planBoardItem(item, fields.filter((f) => f.id !== "f-due"), mapping);
    expect(gone.notes.join(" ")).toContain('no longer has a field "Due date"');
    expect(gone.writes.map((w) => w.field.name)).not.toContain("Due date");
  });
  it("an unmapped field writes nothing, quietly", () => {
    const p = planBoardItem(item, fields, { ...mapping, size: null, group: null });
    expect(p.writes.map((w) => w.field.name)).toEqual(["Priority", "Due date"]);
    expect(p.notes).toEqual([]);
  });
  it("bad dates and unknown sizes are not written", () => {
    const p = planBoardItem({ ...item, end_date: "soon", effort: "huge" }, fields, mapping);
    expect(p.writes.map((w) => w.field.name)).toEqual(["Priority", "Initiative"]);
  });
  it("the signature changes with what would be written and with nothing else", () => {
    const a = planBoardItem(item, fields, mapping).signature;
    expect(planBoardItem(item, fields, mapping).signature).toBe(a);
    expect(planBoardItem({ ...item, moscow: "Must" }, fields, mapping).signature).not.toBe(a);
    expect(planBoardItem({ ...item, effort: "L" }, fields, mapping).signature).not.toBe(a);
    expect(planBoardItem({ ...item, summary: "other" } as never, fields, mapping).signature).toBe(a);
  });
  it("only the four allowed values are ever read: a fully filled item leaks nothing else", () => {
    const sentinel = Object.fromEntries(["value_12m", "confidence", "customers_requesting", "decision", "kr_metric", "outcome_status", "cost_of_not_doing"].map((k) => [k, `LEAK_${k}`]));
    const p = planBoardItem({ ...item, ...sentinel } as never, fields, mapping);
    expect(JSON.stringify(p)).not.toContain("LEAK_");
  });
});

describe("pushBoardItem", () => {
  const plan = planBoardItem(item, fields, mapping);
  it("adds the issue once and writes each value", async () => {
    const sc = new MemorySourceControl();
    const id1 = await pushBoardItem(sc, 1, "PVT_1", "I_node", plan);
    const id2 = await pushBoardItem(sc, 1, "PVT_1", "I_node", plan);
    expect(id2).toBe(id1);
    expect(sc.boardItems).toHaveLength(1);
    expect(sc.boardItems[0]!.values).toEqual({ "f-prio": { optionId: "o-P1" }, "f-init": { optionId: "o-Growth" }, "f-due": { date: "2026-12-15" }, "f-size": { optionId: "o-M" } });
  });
  it("a failure while writing a value propagates, so the push is retried", async () => {
    const sc = new MemorySourceControl();
    sc.failOn = "setBoardValue";
    await expect(pushBoardItem(sc, 1, "PVT_1", "I_node", plan)).rejects.toThrow();
  });
});

describe("parseBoard", () => {
  const stored = { id: "PVT_1", number: 3, title: "Roadmap", url: "https://github.com/orgs/Acme/projects/3", mapping };
  it("reads a stored board back, and fills in the default priority map when none is stored", () => {
    expect(parseBoard(stored)).toEqual(stored);
    const { priorityMap: _drop, ...bare } = mapping;
    expect(parseBoard({ ...stored, mapping: bare })?.mapping.priorityMap).toEqual(DEFAULT_PRIORITY_MAP);
  });
  it("refuses anything that is not a board", () => {
    for (const bad of [null, "x", 5, {}, { ...stored, id: "" }, { ...stored, number: 1.5 }, { ...stored, url: "http://x" }, { ...stored, mapping: { priority: "Priority" } }, { ...stored, mapping: { ...mapping, priorityMap: { Must: 3 } } }, { ...stored, title: "x".repeat(201) }]) expect(parseBoard(bad)).toBeNull();
  });
});
