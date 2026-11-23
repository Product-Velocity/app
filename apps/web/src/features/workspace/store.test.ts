import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryWorkspaceStore, SupabaseWorkspaceStore } from "./store";

type Call = { table: string; ops: [string, unknown[]][] };
function fake(responses: { data?: unknown; error?: unknown }[]) {
  const calls: Call[] = [];
  const make = (call: Call) => {
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          const res = responses.shift() ?? { data: [] };
          return (resolve: (v: unknown) => void) => resolve({ data: res.data ?? null, error: res.error ?? null });
        }
        return (...args: unknown[]) => { call.ops.push([String(prop), args]); return proxy; };
      },
    });
    return proxy;
  };
  const rpcs: { name: string; args: unknown }[] = [];
  const client = {
    from: (table: string) => { const c: Call = { table, ops: [] }; calls.push(c); return make(c); },
    rpc: async (name: string, args: unknown) => { rpcs.push({ name, args }); const res = responses.shift() ?? {}; return { data: null, error: res.error ?? null }; },
  } as unknown as SupabaseClient;
  return { client, calls, rpcs };
}
const has = (c: Call, op: string, ...args: unknown[]) => c.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));
const def = { columns: ["stack_rank", "item_code", "initiative_name", "moscow"], filters: [{ field: "moscow", op: "is" as const, value: "Must" }], groupBy: "health" };
const locked = ["stack_rank", "item_code", "initiative_name"]; // what a view locks when it says nothing: rank, ID and name

describe("SupabaseWorkspaceStore: scopes", () => {
  it("lists scopes with their projects, filtered by tenant", async () => {
    const { client, calls } = fake([{ data: [{ id: "s1", name: "A" }, { id: "s2", name: "B" }] }, { data: [{ scope_id: "s1", project_id: "p1" }, { scope_id: "s1", project_id: "p2" }] }]);
    const scopes = await new SupabaseWorkspaceStore(client, "t1").listScopes();
    expect(scopes).toEqual([{ id: "s1", name: "A", projectIds: ["p1", "p2"] }, { id: "s2", name: "B", projectIds: [] }]);
    for (const c of calls) expect(has(c, "eq", "tenant_id", "t1"), c.table).toBe(true);
  });
  it("creates a scope and its links, tagged with the tenant", async () => {
    const { client, calls } = fake([{ data: { id: "s9" } }, {}, { data: [] }]);
    const r = await new SupabaseWorkspaceStore(client, "t1").createScope("  Customer-facing ", ["p1", "p2"]);
    expect(r).toEqual({ ok: true, value: { id: "s9", name: "Customer-facing", projectIds: ["p1", "p2"] } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "Customer-facing" })).toBe(true);
    expect(calls.some((c) => c.table === "saved_scope_projects" && has(c, "insert", [{ tenant_id: "t1", scope_id: "s9", project_id: "p1" }, { tenant_id: "t1", scope_id: "s9", project_id: "p2" }]))).toBe(true);
  });
  it("does not leave an empty scope behind when the links fail", async () => {
    const { client, calls } = fake([{ data: { id: "s9" } }, {}, { error: { code: "23503" } }, {}]);
    const r = await new SupabaseWorkspaceStore(client, "t1").createScope("X", ["p1"]);
    expect(r.ok).toBe(false);
    expect(calls.at(-1)!.table).toBe("saved_scopes");
    expect(calls.at(-1)!.ops.some(([o]) => o === "delete")).toBe(true);
  });
  it("explains a duplicate name, a missing name and an empty selection", async () => {
    const dup = fake([{ error: { code: "23505" } }]);
    expect(await new SupabaseWorkspaceStore(dup.client, "t1").createScope("Same", ["p1"])).toEqual({ ok: false, error: 'There is already a scope called "Same".' });
    const s = new SupabaseWorkspaceStore(fake([]).client, "t1");
    expect(await s.createScope("   ", ["p1"])).toMatchObject({ ok: false });
    expect(await s.createScope("Name", [])).toEqual({ ok: false, error: "Choose at least one project." });
  });
  it("says so when you may not write", async () => {
    const { client } = fake([{ error: { code: "42501" } }]);
    expect(await new SupabaseWorkspaceStore(client, "t1").createScope("X", ["p1"])).toMatchObject({ ok: false, error: expect.stringMatching(/Creator role/) });
  });
});

describe("projects", () => {
  it("lists projects of the tenant, and creates one with the tenant id", async () => {
    const a = fake([{ data: [{ id: "p1", name: "Platform" }] }]);
    expect(await new SupabaseWorkspaceStore(a.client, "t1").listProjects()).toEqual([{ id: "p1", name: "Platform" }]);
    expect(has(a.calls[0]!, "eq", "tenant_id", "t1")).toBe(true);
    const b = fake([{ data: { id: "p2", name: "Mobile" } }]);
    expect(await new SupabaseWorkspaceStore(b.client, "t1").createProject("  Mobile ")).toEqual({ ok: true, value: { id: "p2", name: "Mobile" } });
    expect(has(b.calls[0]!, "insert", { tenant_id: "t1", name: "Mobile" })).toBe(true);
  });
  it("explains a duplicate, a missing name, and that only admins may add", async () => {
    expect(await new SupabaseWorkspaceStore(fake([{ error: { code: "23505" } }]).client, "t1").createProject("Same")).toEqual({ ok: false, error: 'There is already a project called "Same".' });
    expect(await new SupabaseWorkspaceStore(fake([{ error: { code: "42501" } }]).client, "t1").createProject("X")).toEqual({ ok: false, error: "Only admins can add projects." });
    expect(await new SupabaseWorkspaceStore(fake([]).client, "t1").createProject("  ")).toMatchObject({ ok: false });
  });
});

describe("SupabaseWorkspaceStore: views", () => {
  it("lists views and cleans what it reads", async () => {
    const { client } = fake([{ data: [{ id: "v1", name: "Planning", columns: ["moscow", "nope"], filters: [{ field: "nope", op: "is" }], group_by: "bogus" }] }]);
    expect(await new SupabaseWorkspaceStore(client, "t1").listViews()).toEqual([
      { id: "v1", name: "Planning", baseView: null, ownerId: null, madeOn: null, columns: ["stack_rank", "item_code", "initiative_name", "moscow"], filters: [], groupBy: null, pinned: locked },
    ]);
  });
  it("reads locked columns: an older row lists only the extra locks, a newer one lists them all", async () => {
    const row = { id: "v1", name: "V", columns: ["stack_rank", "item_code", "initiative_name", "moscow", "health"], filters: [], group_by: null };
    const old = fake([{ data: [{ ...row, pinned: ["moscow"] }] }]);
    expect((await new SupabaseWorkspaceStore(old.client, "t1").listViews())[0]!.pinned).toEqual([...locked, "moscow"]);
    const mine = fake([{ data: [{ ...row, pinned: ["health"], pins_explicit: true }] }]);
    const v = (await new SupabaseWorkspaceStore(mine.client, "t1").listViews())[0]!;
    expect(v.pinned).toEqual(["health"]);
    expect(v.columns.slice(0, 1)).toEqual(["health"]); // locked columns come first
    const none = fake([{ data: [{ ...row, pinned: [], pins_explicit: true }] }]);
    expect((await new SupabaseWorkspaceStore(none.client, "t1").listViews())[0]!.pinned).toEqual([]);
  });
  it("creates a view with its columns, filters and grouping", async () => {
    const { client, calls } = fake([{ data: { id: "v2" } }]);
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView(" My view ", def);
    expect(r).toEqual({ ok: true, value: { id: "v2", name: "My view", baseView: null, ownerId: "u1", madeOn: null, ...def, pinned: locked } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "My view", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: locked, pins_explicit: true, sort: null, visibility: "private", owner_id: "u1" })).toBe(true);
  });
  it("creates a workspace view only when asked, with no owner and its sort", async () => {
    const { client, calls } = fake([{ data: { id: "v3" } }]);
    const sort = [{ field: "moscow", dir: "desc" as const }, { field: "initiative_name", dir: "asc" as const }];
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView("Shared", { ...def, sort }, { workspace: true });
    expect(r).toMatchObject({ ok: true, value: { ownerId: null, sort } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "Shared", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: locked, pins_explicit: true, sort, visibility: "workspace", owner_id: null })).toBe(true);
  });
  it("a private view is never customer-safe, and saving needs to know who is signed in", async () => {
    const { client, calls } = fake([{ data: { id: "v4" } }]);
    await new SupabaseWorkspaceStore(client, "t1", "u1").createView("Mine", { columns: ["item_code"], filters: [], groupBy: null, customerSafe: true });
    expect(JSON.stringify(calls[0]!.ops)).toContain('"customer_safe":false');
    expect(await new SupabaseWorkspaceStore(fake([]).client, "t1").createView("x", def)).toMatchObject({ ok: false });
  });
  it("shows the database's readable cap message", async () => {
    const { client } = fake([{ error: { code: "23514", message: "You can have at most 25 private views. Delete one first." } }]);
    expect(await new SupabaseWorkspaceStore(client, "t1", "u1").createView("26th", def)).toEqual({ ok: false, error: "You can have at most 25 private views. Delete one first." });
  });
  it("publishes and unpublishes a view by changing its owner", async () => {
    const up = fake([{ data: [{ id: "v1", name: "A", columns: def.columns, filters: [], group_by: null, owner_id: null }] }]);
    expect(await new SupabaseWorkspaceStore(up.client, "t1", "u1").setViewScope("v1", true)).toMatchObject({ ok: true, value: { ownerId: null } });
    expect(has(up.calls[0]!, "update", { visibility: "workspace", owner_id: null, customer_safe: false })).toBe(true);
    const down = fake([{ data: [{ id: "v1", name: "A", columns: def.columns, filters: [], group_by: null, owner_id: "u1" }] }]);
    await new SupabaseWorkspaceStore(down.client, "t1", "u1").setViewScope("v1", false);
    expect(has(down.calls[0]!, "update", { visibility: "private", owner_id: "u1", customer_safe: false })).toBe(true);
  });
  it("updates only what changed and guards by tenant", async () => {
    const { client, calls } = fake([{ data: [{ id: "v1", name: "Renamed", columns: def.columns, filters: [], group_by: null }] }]);
    const r = await new SupabaseWorkspaceStore(client, "t1").updateView("v1", { name: "Renamed", filters: [] });
    expect(r.ok).toBe(true);
    expect(has(calls[0]!, "update", { name: "Renamed", filters: [] })).toBe(true);
    expect(has(calls[0]!, "eq", "tenant_id", "t1") && has(calls[0]!, "eq", "id", "v1")).toBe(true);
  });
  it("reports a view that is gone, and deletes one", async () => {
    expect(await new SupabaseWorkspaceStore(fake([{ data: [] }]).client, "t1").updateView("v1", { name: "x" })).toMatchObject({ ok: false });
    expect(await new SupabaseWorkspaceStore(fake([{ data: [{ id: "v1" }] }]).client, "t1").deleteView("v1")).toEqual({ ok: true, value: null });
    expect(await new SupabaseWorkspaceStore(fake([{ data: [] }]).client, "t1").deleteView("v1")).toMatchObject({ ok: false });
  });
});

describe("default views and customer-safe views", () => {
  it("customises a default view by inserting an override once, then updating it", async () => {
    const first = fake([{ data: null }, { data: [{ id: "d1", name: "Planning", columns: def.columns, filters: [], group_by: null, base_view: "Planning", customer_safe: false }] }]);
    const r = await new SupabaseWorkspaceStore(first.client, "t1").saveDefaultView("Planning", { ...def, customerSafe: true });
    expect(r).toMatchObject({ ok: true, value: { id: "d1", baseView: "Planning" } });
    expect(has(first.calls[1]!, "insert", { tenant_id: "t1", name: "Planning", base_view: "Planning", columns: def.columns, filters: def.filters, group_by: "health", pinned: locked, pins_explicit: true, sort: null })).toBe(true); // never customer-safe
    const again = fake([{ data: { id: "d1" } }, { data: [{ id: "d1", name: "Planning", columns: def.columns, filters: [], group_by: null, base_view: "Planning", customer_safe: false }] }]);
    await new SupabaseWorkspaceStore(again.client, "t1").saveDefaultView("Planning", def);
    expect(again.calls[1]!.ops.some(([o]) => o === "update")).toBe(true);
    expect(has(again.calls[1]!, "eq", "id", "d1")).toBe(true);
  });
  it("restores a default view by deleting the override of this tenant", async () => {
    const { client, calls } = fake([{ data: null }]);
    expect(await new SupabaseWorkspaceStore(client, "t1").restoreDefaultView("Planning")).toEqual({ ok: true, value: null });
    expect(has(calls[0]!, "delete") && has(calls[0]!, "eq", "tenant_id", "t1") && has(calls[0]!, "eq", "base_view", "Planning")).toBe(true);
  });
  it("saves a customer-safe view with its flag, keeping only safe columns", async () => {
    const { client, calls } = fake([{ data: { id: "v9" } }]);
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView("For customers", { columns: ["stack_rank", "item_code", "initiative_name", "value_12m", "summary"], filters: [], groupBy: null, customerSafe: true }, { workspace: true });
    expect(r).toMatchObject({ ok: true, value: { customerSafe: true, columns: ["item_code", "initiative_name", "summary"] } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "For customers", columns: ["item_code", "initiative_name", "summary"], filters: [], group_by: null, customer_safe: true, pinned: ["item_code", "initiative_name"], pins_explicit: true, sort: null, visibility: "workspace", owner_id: null })).toBe(true);
  });
  it("memory store: customising, restoring and who may", async () => {
    const s = new MemoryWorkspaceStore();
    await s.saveDefaultView("Delivery", def);
    await s.saveDefaultView("Delivery", { ...def, groupBy: null });
    expect((await s.listViews()).filter((v) => v.baseView === "Delivery")).toHaveLength(1);
    await s.restoreDefaultView("Delivery");
    expect(await s.listViews()).toHaveLength(0);
    s.canWrite = false;
    expect(await s.saveDefaultView("Delivery", def)).toMatchObject({ ok: false });
  });
});

describe("MemoryWorkspaceStore projects", () => {
  it("adds projects with unique names, and refuses non-admins", async () => {
    const s = new MemoryWorkspaceStore();
    expect((await s.createProject("A")).ok).toBe(true);
    expect((await s.createProject("a")).ok).toBe(false);
    expect(await s.listProjects()).toHaveLength(1);
    s.admin = false;
    expect(await s.createProject("B")).toEqual({ ok: false, error: "Only admins can add projects." });
  });
});

describe("MemoryWorkspaceStore", () => {
  it("keeps names unique ignoring case, and cleans views", async () => {
    const s = new MemoryWorkspaceStore();
    expect((await s.createView("Planning", def)).ok).toBe(true);
    expect(await s.createView("planning ", def)).toEqual({ ok: false, error: 'There is already a view called "planning".' });
    expect((await s.createScope("A", ["p1"])).ok).toBe(true);
    expect((await s.createScope("a", ["p2"])).ok).toBe(false);
    const v = (await s.listViews())[0]!;
    expect(v.columns.slice(0, 3)).toEqual(["stack_rank", "item_code", "initiative_name"]);
  });
  it("updates and deletes scopes and views", async () => {
    const s = new MemoryWorkspaceStore();
    const sc = (await s.createScope("A", ["p1"])) as { ok: true; value: { id: string } };
    expect(await s.updateScope(sc.value.id, "B", ["p1", "p2"])).toMatchObject({ ok: true, value: { name: "B", projectIds: ["p1", "p2"] } });
    expect(await s.deleteScope(sc.value.id)).toEqual({ ok: true, value: null });
    expect(await s.deleteScope(sc.value.id)).toMatchObject({ ok: false });
    const v = (await s.createView("V", def)) as { ok: true; value: { id: string } };
    expect(await s.updateView(v.value.id, { groupBy: null })).toMatchObject({ ok: true, value: { groupBy: null } });
    expect(await s.deleteView(v.value.id)).toEqual({ ok: true, value: null });
  });
});


describe("layouts", () => {
  it("reads the workspace default and the person's own rows, in order", async () => {
    const { client, calls } = fake([{ data: [
      { page: "grid", user_id: null, view_id: null, builtin: "Timeline", in_bar: true, position: 0, hidden: false },
      { page: "grid", user_id: null, view_id: null, builtin: "History", in_bar: false, position: 1, hidden: true },
      { page: "grid", user_id: "u1", view_id: "v1", builtin: null, in_bar: true, position: 0, hidden: false },
      { page: "gantt", user_id: "u1", view_id: null, builtin: "Delivery", in_bar: true, position: 0, hidden: false },
    ] }]);
    const l = await new SupabaseWorkspaceStore(client, "t1", "u1").listLayouts();
    expect(l.grid.workspace).toEqual([{ ref: { kind: "builtin", name: "Timeline" }, inBar: true, position: 0 }, { ref: { kind: "builtin", name: "History" }, inBar: false, position: 1, hidden: true }]);
    expect(l.grid.mine).toEqual([{ ref: { kind: "saved", id: "v1" }, inBar: true, position: 0 }]);
    expect(l.gantt.mine).toEqual([{ ref: { kind: "builtin", name: "Delivery" }, inBar: true, position: 0 }]); // each page has its own bar
    expect(l.cards).toEqual({ workspace: [], mine: [] });
    expect(has(calls[0]!, "eq", "tenant_id", "t1")).toBe(true);
  });
  it("replaces a layout in one database call and refuses a seventh view before asking", async () => {
    const { client, rpcs } = fake([{}]);
    const s = new SupabaseWorkspaceStore(client, "t1", "u1");
    expect(await s.replaceLayout(false, [{ ref: { kind: "builtin", name: "Planning" }, inBar: true, position: 0 }, { ref: { kind: "saved", id: "v1" }, inBar: false, position: 1 }])).toEqual({ ok: true, value: null });
    expect(rpcs).toEqual([{ name: "replace_view_layout", args: { p_tenant: "t1", p_workspace: false, p_rows: [
      { view_id: null, builtin: "Planning", in_bar: true, position: 0, hidden: false },
      { view_id: "v1", builtin: null, in_bar: false, position: 1, hidden: false },
    ], p_page: "grid" } }]);
    const seven = ["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership", "Discovery"].map((name, position) => ({ ref: { kind: "builtin" as const, name: name as never }, inBar: true, position }));
    expect(await s.replaceLayout(false, seven)).toEqual({ ok: false, error: "Your bar is full (6). Remove one first." });
    expect(rpcs).toHaveLength(1); // the seventh never reached the database
  });
});

describe("memory store: ownership, caps and layouts", () => {
  const mk = (admin: boolean) => new MemoryWorkspaceStore({ me: "u1", admin, views: [{ id: "w1", name: "Shared", ownerId: null, ...def }, { id: "x1", name: "Someone else's", ownerId: "u2", ...def }] });
  it("never lists another person's private view", async () => {
    expect((await mk(false).listViews()).map((v) => v.name)).toEqual(["Shared"]);
  });
  it("a member saves private views, cannot change workspace views, and cannot make a workspace view", async () => {
    const s = mk(false);
    const mine = await s.createView("Mine", def);
    expect(mine).toMatchObject({ ok: true, value: { ownerId: "u1" } });
    expect(await s.updateView("w1", { name: "Nope" })).toMatchObject({ ok: false });
    expect(await s.deleteView("w1")).toMatchObject({ ok: false });
    expect(await s.createView("Public", def, { workspace: true })).toMatchObject({ ok: false });
    expect(await s.updateView("x1", { name: "Nope" })).toMatchObject({ ok: false }); // not visible
  });
  it("an admin changes workspace views and publishes their own private view", async () => {
    const s = mk(true);
    expect(await s.updateView("w1", { name: "Renamed" })).toMatchObject({ ok: true });
    const mine = (await s.createView("Mine", def)) as { ok: true; value: { id: string } };
    expect(await s.setViewScope(mine.value.id, true)).toMatchObject({ ok: true, value: { ownerId: null } });
  });
  it("names are unique per owner: a private view may reuse a workspace name", async () => {
    const s = mk(false);
    expect(await s.createView("Shared", def)).toMatchObject({ ok: true });
    expect(await s.createView(" shared ", def)).toMatchObject({ ok: false });
  });
  it("the 26th private view is refused with a readable message", async () => {
    const s = mk(false);
    for (let i = 1; i <= 25; i++) expect((await s.createView(`V${i}`, def)).ok).toBe(true);
    expect(await s.createView("V26", def)).toEqual({ ok: false, error: "You can have at most 25 private views. Delete one first." });
  });
  it("layouts are per person; only admins write the workspace one; deleting a view clears it from layouts", async () => {
    const s = mk(false);
    const row = { ref: { kind: "saved" as const, id: "w1" }, inBar: true, position: 0 };
    expect(await s.replaceLayout(false, [row])).toEqual({ ok: true, value: null });
    expect((await s.listLayouts()).grid.mine).toHaveLength(1);
    expect(await s.replaceLayout(true, [row])).toMatchObject({ ok: false });
    await s.replaceLayout(false, []);
    expect((await s.listLayouts()).grid.mine).toHaveLength(0);
    const a = mk(true);
    await a.replaceLayout(false, [row]);
    await a.deleteView("w1");
    expect((await a.listLayouts()).grid.mine).toHaveLength(0);
  });
});

describe("saving a sort with a view (issue #207)", () => {
  const sort = [{ field: "moscow", dir: "desc" as const }, { field: "initiative_name", dir: "asc" as const }];
  const viewRow = { id: "v1", name: "V", columns: def.columns, filters: [], group_by: null, sort };
  it("Update writes the sort, and writes null when the definition has no sort (no sort is a saved state)", async () => {
    const a = fake([{ data: [viewRow] }]);
    await new SupabaseWorkspaceStore(a.client, "t1").updateView("v1", { ...def, sort });
    expect(has(a.calls[0]!, "update", { sort, pinned: locked, pins_explicit: true, columns: def.columns, filters: def.filters, group_by: "health", then_by: null, show_issues: false, issue_types: null, issues_hide_done: false })).toBe(true);
    const b = fake([{ data: [{ ...viewRow, sort: null }] }]);
    await new SupabaseWorkspaceStore(b.client, "t1").updateView("v1", { ...def, sort: [] });
    expect(has(b.calls[0]!, "update", { sort: null, pinned: locked, pins_explicit: true, columns: def.columns, filters: def.filters, group_by: "health", then_by: null, show_issues: false, issue_types: null, issues_hide_done: false })).toBe(true);
  });
  it("Update on a built-in view stores the sort too (it used to be dropped)", async () => {
    const first = fake([{ data: null }, { data: [{ id: "d1", name: "Planning", columns: def.columns, filters: [], group_by: null, base_view: "Planning", sort }] }]);
    const r = await new SupabaseWorkspaceStore(first.client, "t1").saveDefaultView("Planning", { ...def, sort });
    expect(r).toMatchObject({ ok: true, value: { sort } });
    expect(has(first.calls[1]!, "insert", { tenant_id: "t1", name: "Planning", base_view: "Planning", columns: def.columns, filters: def.filters, group_by: "health", pinned: locked, pins_explicit: true, sort })).toBe(true);
    const again = fake([{ data: { id: "d1" } }, { data: [{ id: "d1", name: "Planning", columns: def.columns, filters: [], group_by: null, base_view: "Planning", sort: null }] }]);
    await new SupabaseWorkspaceStore(again.client, "t1").saveDefaultView("Planning", { ...def });
    expect(has(again.calls[1]!, "update", { columns: def.columns, filters: def.filters, group_by: "health", pinned: locked, pins_explicit: true, sort: null, widths: null, gantt: null, then_by: null, show_issues: false, issue_types: null, issues_hide_done: false })).toBe(true);
  });
  it("a view read back carries its sort", async () => {
    const { client } = fake([{ data: [viewRow] }]);
    expect((await new SupabaseWorkspaceStore(client, "t1").listViews())[0]!.sort).toEqual(sort);
  });
  it("the in-memory store keeps and clears the sort on Update, for views and built-ins", async () => {
    const s = new MemoryWorkspaceStore({ me: "u1", admin: true });
    const v = (await s.createView("V", { ...def, sort })) as { ok: true; value: { id: string } };
    expect((await s.listViews())[0]!.sort).toEqual(sort);
    await s.updateView(v.value.id, { ...def, sort: [] });
    expect((await s.listViews())[0]!.sort).toBeUndefined();
    await s.saveDefaultView("Planning", { ...def, sort });
    expect((await s.listViews()).find((x) => x.baseView === "Planning")!.sort).toEqual(sort);
    await s.saveDefaultView("Planning", { ...def });
    expect((await s.listViews()).find((x) => x.baseView === "Planning")!.sort).toBeUndefined();
  });
});

describe("two grouping levels and shown issues in a saved view (issue #437)", () => {
  const two = { ...def, thenBy: "moscow", showIssues: true };
  it("reads then_by and show_issues, and an older row reads as one level with no issues", async () => {
    const row = { id: "v1", name: "V", columns: def.columns, filters: [], group_by: "health", then_by: "moscow", show_issues: true };
    const v = (await new SupabaseWorkspaceStore(fake([{ data: [row] }]).client, "t1").listViews())[0]!;
    expect(v).toMatchObject({ groupBy: "health", thenBy: "moscow", showIssues: true });
    const old = (await new SupabaseWorkspaceStore(fake([{ data: [{ ...row, then_by: null, show_issues: null }] }]).client, "t1").listViews())[0]!;
    expect("thenBy" in old).toBe(false);
    expect("showIssues" in old).toBe(false);
  });
  it("a new view writes the two columns only when set", async () => {
    const a = fake([{ data: { id: "v2" } }]);
    await new SupabaseWorkspaceStore(a.client, "t1", "u1").createView("Two", two);
    expect(has(a.calls[0]!, "insert", { tenant_id: "t1", name: "Two", columns: def.columns, filters: def.filters, group_by: "health", then_by: "moscow", show_issues: true, customer_safe: false, pinned: locked, pins_explicit: true, sort: null, visibility: "private", owner_id: "u1" })).toBe(true);
  });
  it("Update writes a changed second level and clears it again", async () => {
    const a = fake([{ data: [{ id: "v1", name: "V", columns: def.columns, filters: [], group_by: "health" }] }]);
    await new SupabaseWorkspaceStore(a.client, "t1").updateView("v1", two);
    const sent = (c: { ops: [string, unknown[]][] }) => c.ops.find(([o]) => o === "update")![1][0] as { then_by?: unknown; show_issues?: unknown };
    expect(sent(a.calls[0] as never)).toMatchObject({ then_by: "moscow", show_issues: true });
    const b = fake([{ data: [{ id: "v1", name: "V", columns: def.columns, filters: [], group_by: "health" }] }]);
    await new SupabaseWorkspaceStore(b.client, "t1").updateView("v1", def);
    expect(sent(b.calls[0] as never)).toMatchObject({ then_by: null, show_issues: false, issue_types: null, issues_hide_done: false });
  });
});

describe("issue types and hide-done in a saved view (issue #437)", () => {
  const withIssues = { ...def, showIssues: true, issueTypes: ["Epic", "Story"], hideDoneIssues: true };
  it("reads issue_types and issues_hide_done; an older row reads as every type, nothing hidden", async () => {
    const row = { id: "v1", name: "V", columns: def.columns, filters: [], group_by: "health", show_issues: true, issue_types: ["Epic", "Story"], issues_hide_done: true };
    const v = (await new SupabaseWorkspaceStore(fake([{ data: [row] }]).client, "t1").listViews())[0]!;
    expect(v).toMatchObject({ showIssues: true, issueTypes: ["Epic", "Story"], hideDoneIssues: true });
    const old = (await new SupabaseWorkspaceStore(fake([{ data: [{ ...row, issue_types: null, issues_hide_done: null }] }]).client, "t1").listViews())[0]!;
    expect("issueTypes" in old).toBe(false);
    expect("hideDoneIssues" in old).toBe(false);
  });
  it("a new view writes the two columns only when set", async () => {
    const a = fake([{ data: { id: "v2" } }]);
    await new SupabaseWorkspaceStore(a.client, "t1", "u1").createView("With", withIssues);
    expect(has(a.calls[0]!, "insert", { tenant_id: "t1", name: "With", columns: def.columns, filters: def.filters, group_by: "health", show_issues: true, issue_types: ["Epic", "Story"], issues_hide_done: true, customer_safe: false, pinned: locked, pins_explicit: true, sort: null, visibility: "private", owner_id: "u1" })).toBe(true);
  });
  it("Update writes the chosen types and the switch, and clears them again", async () => {
    const sent = (c: { ops: [string, unknown[]][] }) => c.ops.find(([o]) => o === "update")![1][0] as { issue_types?: unknown; issues_hide_done?: unknown };
    const a = fake([{ data: [{ id: "v1", name: "V", columns: def.columns, filters: [], group_by: "health" }] }]);
    await new SupabaseWorkspaceStore(a.client, "t1").updateView("v1", withIssues);
    expect(sent(a.calls[0] as never)).toMatchObject({ issue_types: ["Epic", "Story"], issues_hide_done: true });
    const b = fake([{ data: [{ id: "v1", name: "V", columns: def.columns, filters: [], group_by: "health" }] }]);
    await new SupabaseWorkspaceStore(b.client, "t1").updateView("v1", def);
    expect(sent(b.calls[0] as never)).toMatchObject({ issue_types: null, issues_hide_done: false });
  });
});

describe("column widths saved with a view", () => {
  const widths = { moscow: 108 };
  it("a new view stores the widths and reads them back; no widths writes nothing extra", async () => {
    const { client, calls } = fake([{ data: { id: "w1" } }]);
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView("Narrow", { ...def, widths });
    expect(r).toMatchObject({ ok: true, value: { widths } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "Narrow", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: locked, pins_explicit: true, sort: null, widths, visibility: "private", owner_id: "u1" })).toBe(true);
  });
  it("an update writes widths when given, and clears them with an empty object", async () => {
    const a = fake([{ data: [{ id: "w1", name: "Narrow", columns: def.columns, filters: [], group_by: null, base_view: null, customer_safe: false, widths }] }]);
    const ok = await new SupabaseWorkspaceStore(a.client, "t1", "u1").updateView("w1", { widths });
    expect(ok).toMatchObject({ ok: true, value: { widths } });
    expect(has(a.calls[0]!, "update", { widths })).toBe(true);
    const b = fake([{ data: [{ id: "w1", name: "Narrow", columns: def.columns, filters: [], group_by: null, base_view: null, customer_safe: false, widths: null }] }]);
    await new SupabaseWorkspaceStore(b.client, "t1", "u1").updateView("w1", { widths: {} });
    expect(has(b.calls[0]!, "update", { widths: null })).toBe(true);
  });
  it("a stored width of a column the view does not show is ignored when read", async () => {
    const a = fake([{ data: [{ id: "w1", name: "Narrow", columns: def.columns, filters: [], group_by: null, base_view: null, customer_safe: false, widths: { moscow: 108, health: 99, effort: "x" } }] }]);
    const r = await new SupabaseWorkspaceStore(a.client, "t1", "u1").updateView("w1", { name: "Narrow" });
    expect(r).toMatchObject({ ok: true, value: { widths: { moscow: 108 } } });
  });
});

describe("Gantt settings saved with a view (issue #622)", () => {
  const gantt = { zoom: "week" as const, g1: "team", g2: "theme", density: "comfortable" as const };
  it("a new view stores the settings and reads them back", async () => {
    const { client, calls } = fake([{ data: { id: "g1" } }]);
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView("Timeline", { ...def, gantt });
    expect(r).toMatchObject({ ok: true, value: { gantt } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "Timeline", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: locked, pins_explicit: true, sort: null, gantt, visibility: "private", owner_id: "u1" })).toBe(true);
  });
  it("an update writes them when given and clears them with null; an update without them leaves them alone", async () => {
    const row = { id: "g1", name: "Timeline", columns: def.columns, filters: [], group_by: null, base_view: null, customer_safe: false };
    const a = fake([{ data: [{ ...row, gantt }] }]);
    expect(await new SupabaseWorkspaceStore(a.client, "t1", "u1").updateView("g1", { gantt })).toMatchObject({ ok: true, value: { gantt } });
    expect(has(a.calls[0]!, "update", { gantt })).toBe(true);
    const b = fake([{ data: [{ ...row, gantt: null }] }]);
    await new SupabaseWorkspaceStore(b.client, "t1", "u1").updateView("g1", { gantt: undefined as never });
    expect(has(b.calls[0]!, "update", { gantt: null })).toBe(true);
    const c = fake([{ data: [{ ...row, gantt }] }]);
    await new SupabaseWorkspaceStore(c.client, "t1", "u1").updateView("g1", { name: "Renamed" });
    expect(JSON.stringify(c.calls[0])).not.toContain("\"gantt\":null");
  });
  it("unknown stored values fall back when read; the in-memory store keeps the settings", async () => {
    const a = fake([{ data: [{ id: "g1", name: "T", columns: def.columns, filters: [], group_by: null, base_view: null, customer_safe: false, gantt: { zoom: "decade", g1: "team", density: "compact" } }] }]);
    expect((await new SupabaseWorkspaceStore(a.client, "t1", "u1").updateView("g1", { name: "T" }))).toMatchObject({ ok: true, value: { gantt: { zoom: "month", g1: "team" } } });
    const s = new MemoryWorkspaceStore({ me: "u1", admin: true });
    const v = (await s.createView("V", { ...def, gantt })) as { ok: true; value: { id: string } };
    expect((await s.listViews())[0]!.gantt).toEqual(gantt);
    await s.updateView(v.value.id, { gantt: { ...gantt, zoom: "year" } });
    expect((await s.listViews())[0]!.gantt?.zoom).toBe("year");
  });
});

describe("a view bar per page (issue #625)", () => {
  const row = (name: string) => ({ ref: { kind: "builtin" as const, name: name as never }, inBar: true, position: 0 });
  it("the database call names the page", async () => {
    const { client, rpcs } = fake([{}]);
    await new SupabaseWorkspaceStore(client, "t1", "u1").replaceLayout(true, [row("Planning")], "gantt");
    expect(rpcs[0]).toMatchObject({ name: "replace_view_layout", args: { p_workspace: true, p_page: "gantt" } });
  });
  it("the in-memory store keeps one layout per page and person", async () => {
    const s = new MemoryWorkspaceStore({ me: "u1", admin: true });
    await s.replaceLayout(false, [row("Planning")], "gantt");
    await s.replaceLayout(false, [row("Delivery")], "cards");
    const l = await s.listLayouts();
    expect(l.gantt.mine.map((r) => (r.ref as { name: string }).name)).toEqual(["Planning"]);
    expect(l.cards.mine.map((r) => (r.ref as { name: string }).name)).toEqual(["Delivery"]);
    expect(l.grid.mine).toEqual([]);
    await s.replaceLayout(false, [], "gantt");
    expect((await s.listLayouts()).gantt.mine).toEqual([]);
    expect((await s.listLayouts()).cards.mine).toHaveLength(1);
  });
  it("a view remembers the page it was saved on, when it is read back and in memory", async () => {
    const { client, calls } = fake([{ data: { id: "m1" } }]);
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView("On cards", def, { page: "cards" });
    expect(r).toMatchObject({ ok: true, value: { madeOn: "cards" } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "On cards", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: locked, pins_explicit: true, sort: null, made_on: "cards", visibility: "private", owner_id: "u1" })).toBe(true);
    const a = fake([{ data: [{ id: "m1", name: "On cards", columns: def.columns, filters: [], group_by: null, base_view: null, customer_safe: false, made_on: "reports" }] }]);
    expect((await new SupabaseWorkspaceStore(a.client, "t1", "u1").listViews())[0]!.madeOn).toBeNull(); // an unknown page is no page
    const m = new MemoryWorkspaceStore({ me: "u1" });
    await m.createView("V", def, { page: "gantt" });
    expect((await m.listViews())[0]!.madeOn).toBe("gantt");
  });
});
