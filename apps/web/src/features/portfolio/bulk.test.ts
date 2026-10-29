import { describe, expect, it } from "vitest";
import { PortfolioController } from "./controller";
import { MemoryDataSource, sampleItems } from "./memory-source";
import type { Lookups } from "./types";

const lookups: Lookups = {
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
  members: [{ user_id: "u1", email: "ana@example.test" }],
};
function setup(opts: { role?: string; n?: number } = {}) {
  const items = sampleItems(opts.n ?? 6, ["p1", "p2"], ["u1"]);
  const source = new MemoryDataSource(items);
  let n = 0;
  const c = new PortfolioController(source, items, lookups, opts.role ?? "creator", () => new Date(Date.UTC(2027, 3, 14)), () => 1_000, () => `new-${++n}`);
  return { c, source };
}
const ids = ["item-1", "item-2", "item-3"];

describe("bulk edit", () => {
  it("sets one field on selected rows at once, as one undo step", async () => {
    const { c, source } = setup();
    const r = c.bulkEdit(ids, "moscow", "won't");
    expect(r).toEqual({ ok: true, changed: 3, unchanged: 0 });
    expect(ids.map((i) => c.row(i)!.moscow)).toEqual(["Won't", "Won't", "Won't"]);
    expect(c.status.last?.text).toBe("Set MoSCoW to Won't on 3 items");
    expect(c.status.undoCount).toBe(1);
    await c.flush();
    expect(ids.map((i) => source.items.find((x) => x.id === i)!.moscow)).toEqual(["Won't", "Won't", "Won't"]);
    expect(source.calls.filter((x) => x.type === "update")).toHaveLength(3);
  });

  it("one undo puts all three back, one redo sets them again", async () => {
    const { c, source } = setup();
    const before = ids.map((i) => c.row(i)!.moscow);
    c.bulkEdit(ids, "moscow", "Won't");
    await c.flush();
    await c.undo();
    expect(ids.map((i) => c.row(i)!.moscow)).toEqual(before);
    expect(ids.map((i) => source.items.find((x) => x.id === i)!.moscow)).toEqual(before);
    expect(c.status.last?.text).toBe("Undid: Set MoSCoW on 3 items");
    expect(c.status.canUndo).toBe(false);
    await c.redo();
    expect(ids.map((i) => c.row(i)!.moscow)).toEqual(["Won't", "Won't", "Won't"]);
    expect(c.status.last?.text).toBe("Redid: Set MoSCoW on 3 items");
    await c.flush();
  });

  it("parses typed values once for all rows (dates, amounts)", async () => {
    const { c } = setup();
    c.bulkEdit(ids, "start_date", "31 mar");
    c.bulkEdit(ids, "value_12m", "1.5m");
    await c.flush();
    expect(ids.map((i) => [c.row(i)!.start_date, c.row(i)!.value_12m])).toEqual(Array(3).fill(["2027-03-31", 1500000]));
  });

  it("rejects GitHub-driven fields with a clear message and changes nothing", async () => {
    const { c, source } = setup();
    for (const field of ["status", "delivery_progress_pct", "value_weighted", "item_code"]) {
      const r = c.bulkEdit(ids, field, "x");
      expect(r.ok).toBe(false);
    }
    expect(c.bulkEdit(ids, "status", "Completed")).toEqual({ ok: false, error: "Build Status comes from GitHub and cannot be edited here. Change it on the GitHub issue." });
    expect(c.status.notice).toMatch(/comes from GitHub/);
    expect(source.calls).toHaveLength(0);
    expect(c.status.canUndo).toBe(false);
    expect(c.row("item-1")!.status).toBe("Not started");
  });

  it("rejects rank and a bad value without touching any row", () => {
    const { c, source } = setup();
    expect(c.bulkEdit(ids, "stack_rank", "1")).toMatchObject({ ok: false, error: expect.stringMatching(/one item at a time/) });
    expect(c.bulkEdit(ids, "effort", "XXL")).toMatchObject({ ok: false, error: "Choose one of the listed options." });
    expect(c.status.notice).toMatch(/Effort/);
    expect(source.calls).toHaveLength(0);
  });

  it("skips rows that already have the value, and does nothing when all do", async () => {
    const { c, source } = setup();
    c.edit("item-1", "effort", "L");
    await c.flush();
    source.calls.length = 0;
    expect(c.bulkEdit(ids, "effort", "L")).toEqual({ ok: true, changed: 2, unchanged: 1 });
    await c.flush();
    expect(source.calls).toHaveLength(2);
    expect(c.bulkEdit(ids, "effort", "L")).toEqual({ ok: true, changed: 0, unchanged: 3 });
    expect(c.status.undoCount).toBe(2);
  });

  it("clears a field when the value is empty, but not a required one", async () => {
    const { c } = setup();
    expect(c.bulkEdit(ids, "moscow", "")).toMatchObject({ ok: true, changed: 3 });
    expect(c.row("item-1")!.moscow).toBeNull();
    expect(c.bulkEdit(ids, "initiative_name", "")).toMatchObject({ ok: false });
    await c.flush();
  });

  it("a row that cannot be saved goes back to its old value; the others stay", async () => {
    const { c, source } = setup();
    source.failWhen = (op) => (op.type === "update" && op.itemId === "item-2" ? "permission denied" : null);
    const before = c.row("item-2")!.moscow;
    c.bulkEdit(ids, "moscow", "Won't");
    await c.flush();
    expect(c.row("item-2")!.moscow).toBe(before);
    expect(c.row("item-1")!.moscow).toBe("Won't");
    expect(c.status.error).toMatch(/Could not save R-02 MoSCoW: permission denied/);
    expect(c.status.undoCount).toBe(1); // the two that worked can still be undone together
    source.failWhen = null;
    await c.undo();
    expect(["item-1", "item-3"].map((i) => c.row(i)!.moscow)).not.toContain("Won't");
  });

  it("view-only roles cannot bulk edit", () => {
    const { c, source } = setup({ role: "viewer" });
    expect(c.bulkEdit(ids, "moscow", "Won't")).toMatchObject({ ok: false });
    expect(c.status.notice).toMatch(/view-only/);
    expect(source.calls).toHaveLength(0);
  });

  it("ignores ids that no longer exist", async () => {
    const { c } = setup();
    expect(c.bulkEdit(["item-1", "gone"], "effort", "S")).toMatchObject({ ok: true });
    await c.flush();
  });
});

describe("importing many items", () => {
  const rows = [
    { initiative_name: "From Excel 1", home_project: "p1", effort: "M", value_12m: 120000 },
    { initiative_name: "From Excel 2", home_project: "p2", product_manager: "u1", start_date: "2027-05-01" },
  ];

  it("shows all rows at once, saves them in one request tagged as an import, one undo step", async () => {
    const { c, source } = setup();
    expect(c.createItems(rows, { via: "import", label: "Imported 2 items" })).toEqual({ ok: true, created: 2 });
    expect(c.rows.slice(-2).map((r) => [r.initiative_name, r.effort ?? null, r.value_12m ?? null, r.start_date ?? null])).toEqual([
      ["From Excel 1", "M", 120000, null], ["From Excel 2", null, null, "2027-05-01"],
    ]);
    expect(c.status.last?.text).toBe("Imported 2 items");
    await c.flush();
    expect(source.createCalls).toEqual([{ count: 2, via: "import" }]);
    expect(c.rows.slice(-2).map((r) => r.item_code)).toEqual(["R-07", "R-08"]);
    expect(c.status.undoCount).toBe(1);
    await c.undo();
    expect(c.rows).toHaveLength(6);
    expect(source.items).toHaveLength(6);
    expect(source.deleteCalls).toEqual([["new-1", "new-2"]]); // one request for the whole batch
    expect(c.status.last?.text).toBe("Undid: Imported 2 items");
    await c.redo();
    await c.flush();
    expect(c.rows).toHaveLength(8);
    expect(source.items).toHaveLength(8);
  });

  it("is all or nothing: if the save fails no row stays", async () => {
    const { c, source } = setup();
    source.failCreate = "that value is not allowed";
    c.createItems(rows, { via: "import", label: "Imported 2 items" });
    await c.flush();
    expect(c.rows).toHaveLength(6);
    expect(c.status.error).toMatch(/Could not add 2 items: that value is not allowed/);
    expect(c.status.canUndo).toBe(false);
  });
});
