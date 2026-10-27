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
      { id: "v1", name: "Planning", baseView: null, ownerId: null, columns: ["stack_rank", "item_code", "initiative_name", "moscow"], filters: [], groupBy: null },
    ]);
  });
  it("creates a view with its columns, filters and grouping", async () => {
    const { client, calls } = fake([{ data: { id: "v2" } }]);
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView(" My view ", def);
    expect(r).toEqual({ ok: true, value: { id: "v2", name: "My view", baseView: null, ownerId: "u1", ...def } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "My view", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: [], sort: null, visibility: "private", owner_id: "u1" })).toBe(true);
  });
  it("creates a workspace view only when asked, with no owner and its sort", async () => {
    const { client, calls } = fake([{ data: { id: "v3" } }]);
    const sort = { field: "moscow", dir: "desc" as const };
    const r = await new SupabaseWorkspaceStore(client, "t1", "u1").createView("Shared", { ...def, sort }, { workspace: true });
    expect(r).toMatchObject({ ok: true, value: { ownerId: null, sort } });
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "Shared", columns: def.columns, filters: def.filters, group_by: "health", customer_safe: false, pinned: [], sort, visibility: "workspace", owner_id: null })).toBe(true);
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
    expect(has(first.calls[1]!, "insert", { tenant_id: "t1", name: "Planning", base_view: "Planning", columns: def.columns, filters: def.filters, group_by: "health", pinned: [] })).toBe(true); // never customer-safe
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
    expect(has(calls[0]!, "insert", { tenant_id: "t1", name: "For customers", columns: ["item_code", "initiative_name", "summary"], filters: [], group_by: null, customer_safe: true, pinned: [], sort: null, visibility: "workspace", owner_id: null })).toBe(true);
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
      { user_id: null, view_id: null, builtin: "Timeline", in_bar: true, position: 0, hidden: false },
      { user_id: null, view_id: null, builtin: "History", in_bar: false, position: 1, hidden: true },
      { user_id: "u1", view_id: "v1", builtin: null, in_bar: true, position: 0, hidden: false },
    ] }]);
    const l = await new SupabaseWorkspaceStore(client, "t1", "u1").listLayouts();
    expect(l.workspace).toEqual([{ ref: { kind: "builtin", name: "Timeline" }, inBar: true, position: 0 }, { ref: { kind: "builtin", name: "History" }, inBar: false, position: 1, hidden: true }]);
    expect(l.mine).toEqual([{ ref: { kind: "saved", id: "v1" }, inBar: true, position: 0 }]);
    expect(has(calls[0]!, "eq", "tenant_id", "t1")).toBe(true);
  });
  it("replaces a layout in one database call and refuses a seventh view before asking", async () => {
    const { client, rpcs } = fake([{}]);
    const s = new SupabaseWorkspaceStore(client, "t1", "u1");
    expect(await s.replaceLayout(false, [{ ref: { kind: "builtin", name: "Planning" }, inBar: true, position: 0 }, { ref: { kind: "saved", id: "v1" }, inBar: false, position: 1 }])).toEqual({ ok: true, value: null });
    expect(rpcs).toEqual([{ name: "replace_view_layout", args: { p_tenant: "t1", p_workspace: false, p_rows: [
      { view_id: null, builtin: "Planning", in_bar: true, position: 0, hidden: false },
      { view_id: "v1", builtin: null, in_bar: false, position: 1, hidden: false },
    ] } }]);
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
    expect((await s.listLayouts()).mine).toHaveLength(1);
    expect(await s.replaceLayout(true, [row])).toMatchObject({ ok: false });
    await s.replaceLayout(false, []);
    expect((await s.listLayouts()).mine).toHaveLength(0);
    const a = mk(true);
    await a.replaceLayout(false, [row]);
    await a.deleteView("w1");
    expect((await a.listLayouts()).mine).toHaveLength(0);
  });
});
