import { describe, expect, it } from "vitest";
import { PortfolioController, READ_ONLY_MESSAGE } from "./controller";
import { MemoryDataSource, sampleItems } from "./memory-source";
import type { Lookups } from "./types";

const lookups: Lookups = {
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
  members: [{ user_id: "u1", email: "ana@example.test" }, { user_id: "u2", email: "bo@example.test" }],
};
const TODAY = new Date(Date.UTC(2027, 3, 14));

function setup(opts: { role?: string; n?: number; latencyMs?: number; me?: string | null } = {}) {
  const items = sampleItems(opts.n ?? 6, ["p1", "p2"], ["u1", "u2"]);
  for (const i of items) (i as Record<string, unknown>)._created_by = Number(i.id.replace("item-", "")) % 2 === 1 ? "u1" : "u2"; // odd: u1, even: u2
  const source = new MemoryDataSource(items, { latencyMs: opts.latencyMs ?? 0 });
  const c = new PortfolioController(source, items, lookups, "role" in opts ? (opts.role as string) : "creator", () => TODAY, () => 1_000, undefined, "me" in opts ? opts.me! : "u1");
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

describe("list fields of an item (item panel)", () => {
  const panelSetup = () => {
    const items = sampleItems(4, ["p1"], ["u1"]);
    const source = new MemoryDataSource(items);
    source.related.set("item-1", { tags: ["a"], target_scope: [], live_scope: [], target_segments: [], artifacts: [], depends_on: [], related_to: [], contributing_teams: [], assignees: [] });
    const c = new PortfolioController(source, items, { ...lookups, teams: [{ id: "t1", name: "Core" }, { id: "t2", name: "Mobile" }] }, "creator", () => TODAY, () => 1_000);
    return { c, source };
  };
  it("loads the lists of one item once", async () => {
    const { c } = panelSetup();
    expect(c.relatedOf("item-1")).toBeUndefined();
    expect((await c.loadRelated("item-1")).tags).toEqual(["a"]);
    expect(c.relatedOf("item-1")!.tags).toEqual(["a"]);
  });
  it("editing tags is optimistic, saved in the background, shown in the grid cell and undoable", async () => {
    const { c, source } = panelSetup();
    await c.loadRelated("item-1");
    expect(c.editRelated("item-1", "tags", ["a", "  Urgent "])).toEqual({ ok: true, changed: true });
    expect(c.relatedOf("item-1")!.tags).toEqual(["a", "Urgent"]);
    expect(c.row("item-1")!.tags).toBe("a, Urgent");
    expect(c.status.last?.text).toBe("R-01 Tags: added Urgent");
    await c.flush();
    expect(source.related.get("item-1")!.tags).toEqual(["a", "Urgent"]);
    await c.undo();
    expect(c.relatedOf("item-1")!.tags).toEqual(["a"]);
    expect(c.row("item-1")!.tags).toBe("a");
    expect(source.related.get("item-1")!.tags).toEqual(["a"]);
    await c.redo();
    expect(source.related.get("item-1")!.tags).toEqual(["a", "Urgent"]);
  });
  it("a failed save puts the list back and says why", async () => {
    const { c, source } = panelSetup();
    await c.loadRelated("item-1");
    source.failRelated = "no permission";
    c.editRelated("item-1", "tags", ["a", "b"]);
    await c.flush();
    expect(c.relatedOf("item-1")!.tags).toEqual(["a"]);
    expect(c.status.error).toContain("no permission");
  });
  it("relations show item codes, teams show names, and bad values are explained", async () => {
    const { c } = panelSetup();
    await c.loadRelated("item-1");
    c.editRelated("item-1", "depends_on", ["item-2", "item-3"]);
    expect(c.row("item-1")!.depends_on).toBe("R-02; R-03");
    c.editRelated("item-1", "contributing_teams", ["t2"]);
    expect(c.row("item-1")!.contributing_teams).toBe("Mobile");
    expect(c.editRelated("item-1", "related_to", ["item-1"])).toEqual({ ok: false, error: "An initiative cannot refer to itself." });
    expect(c.editRelated("item-1", "artifacts", [{ label: "x", url: "ftp://x" }])).toEqual({ ok: false, error: "A link must start with http:// or https://." });
  });
  it("view-only roles cannot edit lists", async () => {
    const items = sampleItems(2, ["p1"], ["u1"]);
    const c = new PortfolioController(new MemoryDataSource(items), items, lookups, "viewer", () => TODAY, () => 1_000);
    await c.loadRelated("item-1");
    expect(c.editRelated("item-1", "tags", ["x"])).toEqual({ ok: false, error: READ_ONLY_MESSAGE });
  });
  it("effort by skill is a typed value with its own undo step", async () => {
    const { c, source } = panelSetup();
    expect(c.setValue("item-2", "effort_by_skill", { backend: "4", frontend: 2.5, data: 0 })).toEqual({ ok: true, changed: true });
    expect(c.row("item-2")!.effort_by_skill).toEqual({ backend: 4, frontend: 2.5 });
    await c.flush();
    expect(source.items[1]!.effort_by_skill).toEqual({ backend: 4, frontend: 2.5 });
    expect(c.setValue("item-2", "effort_by_skill", { backend: "lots" })).toMatchObject({ ok: false });
    await c.undo();
    expect(c.row("item-2")!.effort_by_skill ?? null).toBeNull();
  });
  it("restoreValue puts an old value back only while the field still holds what that change set", async () => {
    const { c } = panelSetup();
    c.edit("item-1", "health", "Delayed");
    expect(c.restoreValue("item-1", "health", "At Risk", "On Track")).toEqual({ ok: false, error: "The value has changed since. Undo the newer change first." });
    expect(c.restoreValue("item-1", "health", "Delayed", "On Track")).toEqual({ ok: true, changed: true });
    expect(c.row("item-1")!.health).toBe("On Track");
    expect(c.restoreValue("item-1", "status", "Backlog", "Completed")).toMatchObject({ ok: false });
  });
});

describe("moving a Gantt bar: Planned Start and G2M Date (est) together", () => {
  const dated = (role = "creator") => {
    const items = sampleItems(4, ["p1"], ["u1"]).map((i) => ({ ...i, planned_start: "2027-03-01", g2m_date_est: "2027-03-31" }));
    const source = new MemoryDataSource(items);
    return { c: new PortfolioController(source, items, lookups, role, () => TODAY, () => 1_000), source };
  };
  it("changes both dates at once, saves each, and one undo puts both back", async () => {
    const { c, source } = dated();
    expect(c.setDates("item-1", { planned_start: "2027-03-08", g2m_date_est: "2027-04-07" })).toEqual({ ok: true, changed: true });
    expect(c.row("item-1")).toMatchObject({ planned_start: "2027-03-08", g2m_date_est: "2027-04-07" });
    expect(c.status.last?.text).toBe("R-01 Planned Start 1 Mar to 8 Mar, G2M Date (est) 31 Mar to 7 Apr");
    expect(c.status.undoCount).toBe(1);
    await c.flush();
    expect(source.items[0]).toMatchObject({ planned_start: "2027-03-08", g2m_date_est: "2027-04-07" });
    await c.undo();
    expect(c.row("item-1")).toMatchObject({ planned_start: "2027-03-01", g2m_date_est: "2027-03-31" });
    await c.flush();
    expect(source.items[0]).toMatchObject({ planned_start: "2027-03-01", g2m_date_est: "2027-03-31" });
    await c.redo();
    expect(c.row("item-1")!.planned_start).toBe("2027-03-08");
  });
  it("saves only the date that changed (resizing one edge)", async () => {
    const { c, source } = dated();
    c.setDates("item-1", { planned_start: "2027-03-01", g2m_date_est: "2027-04-15" });
    await c.flush();
    expect(source.calls.map((o) => o.type === "update" && o.field)).toEqual(["g2m_date_est"]);
  });
  it("scheduling an item that had no dates sets both in one step", async () => {
    const items = sampleItems(2, ["p1"], ["u1"]).map((i) => ({ ...i, planned_start: null, g2m_date_est: null }));
    const c = new PortfolioController(new MemoryDataSource(items), items, lookups, "creator", () => TODAY, () => 1_000);
    expect(c.setDates("item-1", { planned_start: "2027-05-03", g2m_date_est: "2027-05-30" })).toEqual({ ok: true, changed: true });
    expect(c.status.undoCount).toBe(1);
    await c.undo();
    expect(c.row("item-1")).toMatchObject({ planned_start: null, g2m_date_est: null });
  });
  it("refuses a G2M date before the start, values that are not dates, and view-only roles", () => {
    const { c } = dated();
    expect(c.setDates("item-1", { planned_start: "2027-05-01", g2m_date_est: "2027-04-01" })).toEqual({ ok: false, error: "G2M Date (est) cannot be before Planned Start." });
    expect(c.setDates("item-1", { planned_start: "soon", g2m_date_est: "2027-04-01" })).toEqual({ ok: false, error: "Planned Start is not a date." });
    expect(dated("viewer").c.setDates("item-1", { planned_start: "2027-03-08", g2m_date_est: "2027-04-07" })).toEqual({ ok: false, error: READ_ONLY_MESSAGE });
    expect(c.row("item-1")!.planned_start).toBe("2027-03-01");
  });
  it("a failed save puts that date back and says why", async () => {
    const { c, source } = dated();
    source.failWhen = (op) => (op.type === "update" && op.field === "g2m_date_est" ? "no permission" : null);
    c.setDates("item-1", { planned_start: "2027-03-08", g2m_date_est: "2027-04-07" });
    await c.flush();
    expect(c.row("item-1")).toMatchObject({ planned_start: "2027-03-08", g2m_date_est: "2027-03-31" });
    expect(c.status.error).toContain("no permission");
  });
});

describe("moving a card: several fields as one undo step", () => {
  const setup = () => {
    const items = sampleItems(4, ["p1"], ["u1"]).map((i) => ({ ...i, initiative_phase: "Build", theme: "Onboarding" }));
    const source = new MemoryDataSource(items);
    return { c: new PortfolioController(source, items, { ...lookups, groups: ["Onboarding", "Retention"] }, "creator", () => TODAY, () => 1_000), source };
  };
  it("changes the column and the lane field together; one undo puts both back", async () => {
    const { c, source } = setup();
    expect(c.editFields("item-1", { initiative_phase: "Beta-test", theme: "Retention" })).toEqual({ ok: true, changed: true });
    expect(c.row("item-1")).toMatchObject({ initiative_phase: "Beta-test", theme: "Retention" });
    expect(c.status.last?.text).toBe("R-01 Initiative Phase: Build to Beta-test, Initiative Group: Onboarding to Retention");
    expect(c.status.undoCount).toBe(1);
    await c.flush();
    expect(source.items[0]).toMatchObject({ initiative_phase: "Beta-test", theme: "Retention" });
    await c.undo();
    expect(c.row("item-1")).toMatchObject({ initiative_phase: "Build", theme: "Onboarding" });
    await c.flush();
    expect(source.items[0]).toMatchObject({ initiative_phase: "Build", theme: "Onboarding" });
    await c.redo();
    expect(c.row("item-1")!.initiative_phase).toBe("Beta-test");
  });
  it("null clears a field, a typed group keeps the existing spelling", () => {
    const { c } = setup();
    c.editFields("item-2", { initiative_phase: null, theme: "retention" });
    expect(c.row("item-2")).toMatchObject({ initiative_phase: null, theme: "Retention" });
  });
  it("checks everything first: a refused value changes nothing", () => {
    const { c } = setup();
    expect(c.editFields("item-1", { initiative_phase: "Beta-test", status: "Completed" })).toMatchObject({ ok: false, error: expect.stringContaining("comes from GitHub") });
    expect(c.editFields("item-1", { initiative_phase: "Nonsense" })).toMatchObject({ ok: false });
    expect(c.row("item-1")!.initiative_phase).toBe("Build");
    expect(c.status.undoCount).toBe(0);
  });
  it("saves only what differs, refuses view-only roles, and puts a failed field back on its own", async () => {
    const { c, source } = setup();
    c.editFields("item-1", { initiative_phase: "Build", theme: "Retention" });
    await c.flush();
    expect(source.calls.map((o) => o.type === "update" && o.field)).toEqual(["theme"]);
    const items = sampleItems(1, ["p1"], ["u1"]);
    expect(new PortfolioController(new MemoryDataSource(items), items, lookups, "viewer", () => TODAY, () => 1_000).editFields("item-1", { moscow: "Must" })).toEqual({ ok: false, error: READ_ONLY_MESSAGE });
    source.failWhen = (op) => (op.type === "update" && op.field === "theme" ? "no permission" : null);
    c.editFields("item-2", { initiative_phase: "Define", theme: "Retention" });
    await c.flush();
    expect(c.row("item-2")).toMatchObject({ initiative_phase: "Define", theme: "Onboarding" });
    expect(c.status.error).toContain("no permission");
  });
});

describe("delete, undo and the Trash", () => {
  const ranks = (c: PortfolioController) => c.rows.map((r) => [r.id, r.stack_rank]);

  it("the rows leave the grid at once, go to the Trash in ONE request, and the ranks close up", async () => {
    const { c, source } = setup({ role: "admin", latencyMs: 15 });
    const r = c.deleteItems(["item-2", "item-4", "item-5"]);
    expect(r).toEqual({ ok: true, deleted: 3, skipped: [] });
    expect(c.row("item-2")).toBeUndefined(); // before the save returned
    expect(c.rows.map((x) => x.stack_rank)).toEqual([1, 2, 3]);
    expect(c.status.last?.text).toBe("Deleted 3 items");
    await c.flush();
    expect(source.trashCalls).toEqual([{ op: "trash", ids: ["item-2", "item-4", "item-5"] }]);
    expect(source.items.map((i) => i.id)).toEqual(["item-1", "item-3", "item-6"]);
    expect(source.trash.map((t) => t.id).sort()).toEqual(["item-2", "item-4", "item-5"]);
    expect(c.status.error).toBeNull();
  });

  it("one undo step restores them at the same ranks with the same fields; redo deletes them again", async () => {
    const { c, source } = setup({ role: "admin" });
    const before = ranks(c);
    const name = c.row("item-3")!.initiative_name;
    c.deleteItems(["item-2", "item-3"]);
    await c.flush();
    expect(c.status.undoCount).toBe(1);
    await c.undo();
    expect(ranks(c)).toEqual(before);
    expect(c.row("item-3")!.initiative_name).toBe(name);
    expect(source.items.map((i) => [i.id, i.stack_rank])).toEqual(before);
    expect(source.trash).toHaveLength(0);
    expect(c.status.last?.text).toBe("Undid: Deleted 2 items");
    await c.redo();
    expect(c.row("item-2")).toBeUndefined();
    expect(c.rows.map((x) => x.stack_rank)).toEqual([1, 2, 3, 4]);
    expect(source.trash.map((t) => t.id).sort()).toEqual(["item-2", "item-3"]);
  });

  it("deleting one item says which one in the status line", () => {
    const { c } = setup({ role: "admin" });
    c.deleteItems(["item-3"]);
    expect(c.status.last?.text).toBe('Deleted R-03 "Initiative number 3 with a reasonably long title"');
  });

  it("a creator deletes only items they added; the others are skipped and named", async () => {
    const { c, source } = setup({ role: "creator", me: "u1" });
    const r = c.deleteItems(["item-1", "item-2", "item-3"]); // 1 and 3 are u1's, 2 is u2's
    expect(r).toMatchObject({ ok: true, deleted: 2 });
    expect((r as { skipped: unknown[] }).skipped).toEqual([{ id: "item-2", name: expect.any(String), reason: "Only the person who added it or an admin can delete it." }]);
    expect(c.row("item-2")).toBeDefined();
    expect(c.status.notice).toMatch(/1 could not be deleted/);
    await c.flush();
    expect(source.trashCalls[0]!.ids).toEqual(["item-1", "item-3"]);
    expect(c.canDelete("item-2")).toBe(false);
    expect(c.canDelete("item-5")).toBe(true);
  });

  it("viewers, commenters and leadership cannot delete, and nothing is sent", () => {
    for (const role of ["viewer", "commenter", "leadership", null]) {
      const { c, source } = setup({ role: role as string });
      expect(c.deleteItems(["item-1"])).toMatchObject({ ok: false });
      expect(c.row("item-1")).toBeDefined();
      expect(source.trashCalls).toHaveLength(0);
    }
  });

  it("when the server refuses some, they come back and only the others stay deleted", async () => {
    const { c, source } = setup({ role: "admin" });
    source.refuse.set("item-3", "Your role cannot delete initiatives.");
    c.deleteItems(["item-2", "item-3"]);
    await c.flush();
    expect(c.row("item-2")).toBeUndefined();
    expect(c.row("item-3")).toBeDefined();
    expect(ranks(c)).toEqual(source.items.map((i) => [i.id, i.stack_rank]));
    expect(c.status.error).toMatch(/1 item could not be deleted: Your role cannot delete initiatives\./);
    await c.undo(); // the step now covers only the item that did go
    expect(source.trash).toHaveLength(0);
    expect(c.rows).toHaveLength(6);
  });

  it("when the whole request fails, everything comes back at its rank with a message", async () => {
    const { c, source } = setup({ role: "admin" });
    const before = ranks(c);
    source.failTrash = "network down";
    c.deleteItems(["item-1", "item-4"]);
    await c.flush();
    expect(ranks(c)).toEqual(before);
    expect(c.status.error).toMatch(/Could not delete 2 items: network down\. The change was reverted\./);
    expect(c.status.canUndo).toBe(false);
  });

  it("a failed undo puts the deleted state back and keeps the step", async () => {
    const { c, source } = setup({ role: "admin" });
    c.deleteItems(["item-2"]);
    await c.flush();
    source.failTrash = "offline";
    await c.undo();
    expect(c.row("item-2")).toBeUndefined();
    expect(c.status.error).toMatch(/offline/);
    expect(c.status.canUndo).toBe(true);
  });

  it("references to a deleted item read '(deleted item)'", async () => {
    const { c, source } = setup({ role: "admin" });
    source.related.set("item-1", { ...(await source.loadRelated("item-1")), depends_on: ["item-2"] });
    await c.loadRelated("item-1");
    c.editRelated("item-1", "depends_on", ["item-2", "item-3"]);
    expect(c.row("item-1")!.depends_on).toBe("R-02; R-03");
    c.deleteItems(["item-2"]);
    c.editRelated("item-1", "related_to", []); // any change re-renders; the text of depends_on is checked below
    // the cached list still holds the id; the grid text for a missing item
    expect((c as unknown as { listText: (f: string, l: unknown[]) => string | null }).listText("depends_on", ["item-2", "item-3"])).toBe("(deleted item); R-03");
  });

  it("the Trash lists who deleted what; restore and delete forever go through the source", async () => {
    const { c, source } = setup({ role: "admin" });
    c.deleteItems(["item-2", "item-5"]);
    await c.flush();
    expect((await source.loadTrash()).map((t) => t.item_code)).toEqual(["R-05", "R-02"]);
    const r = await source.restoreItems(["item-5"]);
    expect(r).toMatchObject({ ok: true, restored: [{ id: "item-5", stack_rank: 5 }], failed: [] });
    expect(await source.purgeItems(["item-2", "item-1"])).toEqual({ ok: true, failed: [{ id: "item-1", reason: "Only items in the Trash can be deleted forever." }] });
    expect(source.trash).toHaveLength(0);
  });
});
