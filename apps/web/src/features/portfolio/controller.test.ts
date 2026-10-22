import { describe, expect, it } from "vitest";
import { PortfolioController, READ_ONLY_MESSAGE } from "./controller";
import { MemoryDataSource, sampleItems } from "./memory-source";
import type { Lookups } from "./types";

const lookups: Lookups = {
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
  members: [{ user_id: "u1", email: "ana@example.test" }, { user_id: "u2", email: "bo@example.test" }],
};
const TODAY = new Date(Date.UTC(2027, 3, 14));

function setup(opts: { role?: string; n?: number; latencyMs?: number } = {}) {
  const items = sampleItems(opts.n ?? 6, ["p1", "p2"], ["u1", "u2"]);
  const source = new MemoryDataSource(items, { latencyMs: opts.latencyMs ?? 0 });
  const c = new PortfolioController(source, items, lookups, "role" in opts ? (opts.role as string) : "creator", () => TODAY, () => 1_000);
  return { c, source };
}

describe("editing", () => {
  it("shows the change at once and saves in the background", async () => {
    const { c, source } = setup({ latencyMs: 20 });
    const r = c.edit("item-1", "health", "At Risk");
    expect(r).toEqual({ ok: true, changed: true });
    expect(c.row("item-1")!.health).toBe("At Risk"); // before the save returned
    expect(c.status.pending).toBe(1);
    expect(c.status.last?.text).toBe("R-01 Health: On Track to At Risk");
    await c.flush();
    expect(c.status.pending).toBe(0);
    expect(c.status.error).toBeNull();
    expect(source.items[0]!.health).toBe("At Risk");
  });

  it("does nothing for an unchanged value", async () => {
    const { c, source } = setup();
    const r = c.edit("item-1", "effort", "XS");
    expect(r).toEqual({ ok: true, changed: false });
    expect(source.calls).toHaveLength(0);
    expect(c.status.canUndo).toBe(false);
  });

  it("parses typed text: dates, values, confidence", async () => {
    const { c } = setup();
    c.edit("item-2", "start_date", "31 mar");
    c.edit("item-2", "g2m_date_est", "q2");
    c.edit("item-2", "value_12m", "1.2m");
    c.edit("item-2", "confidence", "Low");
    await c.flush();
    const r = c.row("item-2")!;
    expect([r.start_date, r.g2m_date_est, r.value_12m, r.confidence]).toEqual(["2027-03-31", "2027-06-30", 1200000, "Low"]);
  });

  it("rejects bad input with a message and changes nothing", async () => {
    const { c, source } = setup();
    const r = c.edit("item-1", "start_date", "banana");
    expect(r.ok).toBe(false);
    expect(c.row("item-1")!.start_date).toBe("2027-01-04");
    expect(c.status.notice).toMatch(/R-01 Start Date/);
    expect(source.calls).toHaveLength(0);
    expect(c.edit("item-1", "initiative_name", "   ").ok).toBe(false);
    expect(c.edit("item-1", "confidence", "150").ok).toBe(false);
  });

  it("view-only roles cannot edit, undo or re-rank", async () => {
    for (const role of ["viewer", "commenter", "leadership", null]) {
      const { c, source } = setup({ role: role as string });
      expect(c.canEdit).toBe(false);
      expect(c.edit("item-1", "initiative_name", "x").ok).toBe(false);
      expect(c.status.notice).toBe(READ_ONLY_MESSAGE);
      expect(c.editRank("item-1", "1").ok).toBe(false);
      await c.undo();
      expect(source.calls).toHaveLength(0);
    }
  });

  it("clears nullable cells and refuses to empty the title or project", async () => {
    const { c } = setup();
    expect(c.clearCell("item-2", "health")).toEqual({ ok: true, changed: true });
    expect(c.row("item-2")!.health).toBeNull();
    expect(c.clearCell("item-2", "initiative_name").ok).toBe(false);
    expect(c.clearCell("item-2", "home_project").ok).toBe(false);
    await c.flush();
  });

  it("changing the project recomputes the In project order", async () => {
    const { c } = setup();
    expect(c.row("item-1")!.project_rank).toBe(1); // first in p1
    expect(c.row("item-3")!.project_rank).toBe(2);
    c.edit("item-1", "home_project", "p2");
    expect(c.row("item-3")!.project_rank).toBe(1);
    expect(c.row("item-1")!.project_rank).toBe(1); // first in p2 now (rank 1 globally)
    await c.flush();
  });
});

describe("when a save fails", () => {
  it("puts the old value back, explains why, and forgets the change", async () => {
    const { c, source } = setup();
    source.failWhen = () => "permission denied";
    c.edit("item-1", "health", "Delayed");
    await c.flush();
    expect(c.row("item-1")!.health).toBe("On Track");
    expect(c.status.error).toBe("Could not save R-01 Health: permission denied. The change was reverted.");
    expect(c.status.canUndo).toBe(false);
    source.failWhen = null;
    c.edit("item-1", "health", "Delayed");
    await c.flush();
    expect(c.status.error).toBeNull(); // cleared by the next success
  });

  it("an exception from the source is handled like a failure", async () => {
    const { c, source } = setup();
    source.updateField = async () => { throw new Error("network down"); };
    c.edit("item-1", "initiative_name", "New");
    await c.flush();
    expect(c.row("item-1")!.initiative_name).toMatch(/Initiative number 1/);
    expect(c.status.error).toMatch(/network down/);
  });
});

describe("saves for the same cell keep their order", () => {
  it("a slow first save cannot overwrite a fast second one", async () => {
    const { c, source } = setup();
    const order: string[] = [];
    const real = source.updateField.bind(source);
    let n = 0;
    source.updateField = async (id, f, v, o) => {
      const mine = ++n;
      await new Promise((r) => setTimeout(r, mine === 1 ? 40 : 1));
      order.push(String(v));
      return real(id, f, v, o);
    };
    c.edit("item-1", "initiative_name", "First");
    c.edit("item-1", "initiative_name", "Second");
    await c.flush();
    expect(order).toEqual(["First", "Second"]);
    expect(source.items[0]!.initiative_name).toBe("Second");
  });
});

describe("undo and redo", () => {
  it("undoes and redoes field edits, saving each as its own audited write", async () => {
    const { c, source } = setup();
    c.edit("item-1", "health", "At Risk");
    c.edit("item-1", "moscow", "Could");
    await c.flush();
    await c.undo();
    expect(c.row("item-1")!.moscow).toBe("Must");
    expect(c.status.last?.text).toBe("Undid: R-01 MoSCoW: Could to Must");
    await c.undo();
    expect(c.row("item-1")!.health).toBe("On Track");
    expect(c.status.canUndo).toBe(false);
    await c.redo();
    expect(c.row("item-1")!.health).toBe("At Risk");
    await c.flush();
    expect(source.items[0]!.health).toBe("At Risk");
    expect(source.items[0]!.moscow).toBe("Must");
    // undo saves are guarded by the value they expect to replace
    expect(source.calls.filter((x) => x.type === "update" && "expected" in x).length).toBe(3);
  });

  it("keeps the last 20 changes", async () => {
    const { c } = setup();
    for (let i = 0; i < 25; i++) c.edit("item-1", "initiative_name", `Name ${i}`);
    await c.flush();
    expect(c.status.undoCount).toBe(20);
    for (let i = 0; i < 25; i++) await c.undo();
    expect(c.row("item-1")!.initiative_name).toBe("Name 4"); // 5 oldest edits can no longer be undone
  });

  it("does not undo over a change somebody else made", async () => {
    const { c, source } = setup();
    c.edit("item-1", "health", "At Risk");
    await c.flush();
    source.items[0]!.health = "Delayed"; // someone else changed it in the database
    await c.undo();
    expect(c.row("item-1")!.health).toBe("At Risk"); // the grid still shows our value
    expect(c.status.error).toMatch(/Could not undo|changed/i);
    expect(c.status.canUndo).toBe(true); // the step is kept, nothing was lost
    expect(source.items[0]!.health).toBe("Delayed");
  });

  it("when the undo save fails, the value goes back and the step is kept", async () => {
    const { c, source } = setup();
    c.edit("item-1", "effort", "XL");
    await c.flush();
    source.failWhen = () => "offline";
    await c.undo();
    expect(c.row("item-1")!.effort).toBe("XL");
    expect(c.status.error).toMatch(/offline/);
    expect(c.status.canUndo).toBe(true);
    source.failWhen = null;
    await c.undo();
    expect(c.row("item-1")!.effort).toBe("XS");
  });

  it("a new edit clears the redo list", async () => {
    const { c } = setup();
    c.edit("item-1", "initiative_name", "A");
    await c.flush(); await c.undo();
    expect(c.status.canRedo).toBe(true);
    c.edit("item-1", "initiative_name", "B");
    expect(c.status.canRedo).toBe(false);
    await c.flush();
  });
});

describe("re-ranking", () => {
  it("typing a new global rank moves the item and shifts the others, like the database", async () => {
    const { c, source } = setup();
    expect(c.editRank("item-4", "2")).toEqual({ ok: true, changed: true });
    expect(c.rows.map((r) => r.id)).toEqual(["item-1", "item-4", "item-2", "item-3", "item-5", "item-6"]);
    expect(c.rows.map((r) => r.stack_rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.status.last?.text).toBe("R-04 moved from rank 4 to 2");
    await c.flush();
    expect(source.items.map((i) => `${i.id}:${i.stack_rank}`).sort()).toEqual(c.rows.map((r) => `${r.id}:${r.stack_rank}`).sort());
    expect(source.calls).toEqual([{ type: "move", itemId: "item-4", to: 2 }]);
  });

  it("clamps, validates and updates the In project order", async () => {
    const { c } = setup();
    expect(c.editRank("item-1", "999")).toEqual({ ok: true, changed: true });
    expect(c.row("item-1")!.stack_rank).toBe(6);
    expect(c.editRank("item-1", "0").ok).toBe(false);
    expect(c.editRank("item-1", "abc").ok).toBe(false);
    expect(c.editRank("item-1", "#3")).toEqual({ ok: true, changed: true });
    expect(c.rows.filter((r) => r.home_project === "p1").map((r) => r.project_rank)).toEqual([1, 2, 3]);
    await c.flush();
  });

  it("undoes a move", async () => {
    const { c } = setup();
    c.editRank("item-5", "1");
    await c.flush();
    await c.undo();
    expect(c.rows.map((r) => r.id)).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"]);
    await c.flush();
  });

  it("a failed move is reverted", async () => {
    const { c, source } = setup();
    source.failWhen = (op) => (op.type === "move" ? "not allowed" : null);
    c.editRank("item-3", "1");
    await c.flush();
    expect(c.rows.map((r) => r.id)).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"]);
    expect(c.status.error).toMatch(/R-03 rank: not allowed/);
  });
});

describe("notices", () => {
  it("explains locked GitHub cells", () => {
    const { c } = setup();
    c.notifyReadOnly("status");
    expect(c.status.notice).toMatch(/GitHub/);
    c.notify(null);
    expect(c.status.notice).toBeNull();
  });
  it("notifies subscribers with the rows that changed", async () => {
    const { c } = setup();
    const seen: string[] = [];
    c.subscribe((rows) => seen.push(...rows.map((r) => r.id)));
    c.edit("item-2", "initiative_name", "Changed");
    expect(seen).toContain("item-2");
    await c.flush();
  });
});

describe("Initiative Group is an open list", () => {
  const withGroups = () => {
    const items = sampleItems(4, ["p1"], ["u1"]);
    const source = new MemoryDataSource(items);
    const c = new PortfolioController(source, items, { ...lookups, groups: ["Retention", "Onboarding"] }, "creator", () => TODAY, () => 1_000);
    return { c, source };
  };
  it("lists the workspace groups A to Z", () => {
    expect(withGroups().c.groupNames()).toEqual(["Onboarding", "Retention"]);
  });
  it("typing the same group in another case saves the existing spelling", async () => {
    const { c, source } = withGroups();
    expect(c.edit("item-1", "theme", "  onboarding ")).toEqual({ ok: true, changed: true });
    expect(c.row("item-1")!.theme).toBe("Onboarding");
    await c.flush();
    expect(source.items[0]!.theme).toBe("Onboarding");
    expect(c.groupNames()).toEqual(["Onboarding", "Retention"]);
  });
  it("typing a new group creates it, at once for the next picker, and one undo removes the value", async () => {
    const { c, source } = withGroups();
    c.edit("item-2", "theme", "Billing");
    await c.flush();
    expect(source.items[1]!.theme).toBe("Billing");
    expect(c.groupNames()).toContain("Billing");
    await c.undo();
    expect(c.row("item-2")!.theme ?? null).toBeNull();
  });
  it("a bulk edit and new items use the same rules", async () => {
    const { c, source } = withGroups();
    c.bulkEdit(["item-1", "item-2"], "theme", "retention");
    expect(c.row("item-1")!.theme).toBe("Retention");
    const r = c.createItems([{ initiative_name: "New one", home_project: "p1", theme: "ONBOARDING" }]);
    expect(r).toEqual({ ok: true, created: 1 });
    await c.flush();
    expect(source.items.at(-1)!.theme).toBe("Onboarding");
  });
});
