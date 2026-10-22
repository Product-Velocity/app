import { describe, expect, it } from "vitest";
import { PortfolioController } from "./controller";
import { MemoryDataSource, sampleItems } from "./memory-source";
import type { Lookups } from "./types";

const lookups: Lookups = {
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
  members: [{ user_id: "u1", email: "ana@example.test" }],
};
const draft = (name: string, project = "p1") => ({ initiative_name: name, home_project: project, product_manager: null, effort: null, moscow: null });

function setup(opts: { role?: string; n?: number } = {}) {
  const items = sampleItems(opts.n ?? 3, ["p1", "p2"], ["u1"]);
  const source = new MemoryDataSource(items);
  let n = 0;
  const c = new PortfolioController(source, items, lookups, opts.role ?? "creator", () => new Date(Date.UTC(2027, 3, 14)), () => 1_000, () => `new-${++n}`);
  return { c, source };
}

describe("quick-add", () => {
  it("shows the new item at once at the end of the list and saves it", async () => {
    const { c, source } = setup();
    const r = c.createItems([{ initiative_name: "Faster search", home_project: "p2", product_manager: "u1", effort: "M", moscow: "Should" }]);
    expect(r).toEqual({ ok: true, created: 1 });
    const row = c.row("new-1")!;
    expect(row).toMatchObject({ initiative_name: "Faster search", home_project: "p2", product_manager: "u1", effort: "M", moscow: "Should", stack_rank: 4, project_rank: 2 });
    expect(c.rows.at(-1)!.id).toBe("new-1");
    expect(c.status.pending).toBe(1);
    expect(c.status.last?.text).toBe('Added "Faster search"');
    await c.flush();
    expect(source.items.find((i) => i.id === "new-1")).toMatchObject({ initiative_name: "Faster search", stack_rank: 4 });
    expect(row.item_code).toBe("R-04"); // assigned by the database, copied into the row
    expect(c.status.error).toBeNull();
  });

  it("adds many at once as one undo step, in order", async () => {
    const { c, source } = setup();
    c.createItems([draft("A"), draft("B"), draft("C")]);
    expect(c.rows.slice(-3).map((r) => [r.initiative_name, r.stack_rank])).toEqual([["A", 4], ["B", 5], ["C", 6]]);
    await c.flush();
    expect(source.createCalls).toEqual([{ count: 3 }]); // one request
    expect(source.items.slice(-3).map((r) => r.initiative_name)).toEqual(["A", "B", "C"]);
    expect(c.status.undoCount).toBe(1);
    expect(c.status.last?.text).toBe("Added 3 items");
  });

  it("undo removes the items again and redo adds them back", async () => {
    const { c, source } = setup();
    c.createItems([draft("A"), draft("B")]);
    await c.flush();
    await c.undo();
    expect(c.rows.map((r) => r.initiative_name)).not.toContain("A");
    expect(c.rows).toHaveLength(3);
    expect(source.items).toHaveLength(3);
    expect(c.status.last?.text).toMatch(/^Undid: Added/);
    await c.redo();
    await c.flush();
    expect(c.rows.slice(-2).map((r) => r.initiative_name)).toEqual(["A", "B"]);
    expect(source.items).toHaveLength(5);
    expect(c.rows.map((r) => r.stack_rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a failed save removes the item and says why", async () => {
    const { c, source } = setup();
    source.failCreate = "permission denied";
    c.createItems([draft("Nope")]);
    await c.flush();
    expect(c.rows.find((r) => r.initiative_name === "Nope")).toBeUndefined();
    expect(c.status.error).toMatch(/Could not add "Nope": permission denied/);
    expect(c.status.canUndo).toBe(false);
  });

  it("view-only roles cannot add", () => {
    const { c, source } = setup({ role: "viewer" });
    expect(c.createItems([draft("A")])).toMatchObject({ ok: false });
    expect(c.rows).toHaveLength(3);
    expect(source.items).toHaveLength(3);
    expect(c.status.notice).toMatch(/view-only/);
  });

  it("tells subscribers which rows were added and removed", async () => {
    const { c } = setup();
    const events: string[] = [];
    c.onStructure((add, remove) => events.push(`+${add.length}-${remove.length}`));
    c.createItems([draft("A")]);
    await c.flush();
    await c.undo();
    expect(events).toEqual(["+1-0", "+0-1"]);
  });
});
