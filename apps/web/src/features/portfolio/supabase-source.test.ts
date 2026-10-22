import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyError, PAGE_SIZE, SupabaseDataSource } from "./supabase-source";

type Call = { table?: string; rpc?: string; ops: [string, unknown[]][] };

/** A stand-in for the Supabase client that records the query chain and answers from a queue. */
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
  const client = {
    from: (table: string) => { const c: Call = { table, ops: [] }; calls.push(c); return make(c); },
    rpc: (name: string, args: unknown) => { const c: Call = { rpc: name, ops: [["args", [args]]] }; calls.push(c); return make(c); },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const has = (c: Call, op: string, ...args: unknown[]) => c.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));

const row = (i: number) => ({ id: `i${i}`, tenant_id: "t1", cycle_id: null, item_code: `R-${i}`, initiative_name: "t", stack_rank: i, home_project_id: "p", owner_user_id: null, moscow: null, effort: null, health: null, value_12m: "1200.50", confidence: "High", start_date: null, end_date: null, status: null, delivery_progress_pct: "40.00", kr_target: "7" });

describe("loadItems", () => {
  it("reads every page, filtered by tenant and cycle, in rank order", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => row(i + 1));
    const page2 = Array.from({ length: 300 }, (_, i) => row(PAGE_SIZE + i + 1));
    const { client, calls } = fake([{ data: page1 }, { data: page2 }]);
    const items = await new SupabaseDataSource(client, "t1").loadItems();
    expect(items).toHaveLength(1300);
    const itemCalls = calls.filter((c) => c.table === "items");
    expect(itemCalls).toHaveLength(2);
    for (const c of itemCalls) {
      expect(c.table).toBe("items");
      expect(has(c, "eq", "tenant_id", "t1")).toBe(true);
      expect(has(c, "is", "cycle_id", null)).toBe(true);
      expect(has(c, "order", "stack_rank", { ascending: true })).toBe(true);
    }
    expect(has(itemCalls[0]!, "range", 0, PAGE_SIZE - 1)).toBe(true);
    expect(has(itemCalls[1]!, "range", PAGE_SIZE, 2 * PAGE_SIZE - 1)).toBe(true);
  });

  it("also reads the calculated view and every related table, each filtered by tenant", async () => {
    const { client, calls } = fake([{ data: [row(1)] }]);
    await new SupabaseDataSource(client, "t1").loadItems();
    expect(calls.map((c) => c.table)).toEqual(["items", "items_computed", "item_tags", "item_links", "item_files", "item_relations", "teams", "item_teams"]);
    for (const c of calls) expect(has(c, "eq", "tenant_id", "t1"), String(c.table)).toBe(true);
  });

  it("names the project field home_project, drops internal columns and shows related values as text", async () => {
    const { client } = fake([
      { data: [row(1), row(2)] },
      { data: [{ id: "i1", value_weighted: "1080.45", time_discovery_days: null, locked_by_source: false }] },
      { data: [{ item_id: "i1", kind: "tag", value: "b" }, { item_id: "i1", kind: "tag", value: "a" }, { item_id: "i1", kind: "segment", value: "EU" }] },
      { data: [{ item_id: "i1", label: "PRD", url: "https://x.test" }] },
      { data: [] },
      { data: [{ item_id: "i1", related_item_id: "i2", kind: "depends_on" }] },
      { data: [{ id: "tm", name: "Core" }] },
      { data: [{ item_id: "i1", team_id: "tm" }] },
    ]);
    const [a, b] = await new SupabaseDataSource(client, "t1").loadItems();
    expect(a).toMatchObject({ home_project: "p", tags: "b, a", target_segments: "EU", artifacts: "PRD (https://x.test)", depends_on: "R-2", contributing_teams: "Core", value_weighted: 1080.45, locked_by_source: false });
    expect(a).not.toHaveProperty("tenant_id");
    expect(a).not.toHaveProperty("home_project_id");
    expect(a).toHaveProperty("product_manager", null); // read from owner_user_id
    expect(a).toHaveProperty("g2m_date_est", null); // read from end_date
    expect(a).not.toHaveProperty("owner_user_id");
    expect(b).toMatchObject({ tags: null, depends_on: null });
  });

  it("turns numeric strings into numbers", async () => {
    const { client } = fake([{ data: [row(1)] }]);
    const [item] = await new SupabaseDataSource(client, "t1").loadItems();
    expect([item!.value_12m, item!.delivery_progress_pct, item!.kr_target, item!.confidence]).toEqual([1200.5, 40, 7, "High"]);
  });

  it("stops after one short page, and fails with a readable message", async () => {
    const one = fake([{ data: [row(1)] }]);
    await new SupabaseDataSource(one.client, "t1").loadItems();
    expect(one.calls.filter((c) => c.table === "items")).toHaveLength(1);
    const bad = fake([{ error: { code: "42501", message: "denied" } }]);
    await expect(new SupabaseDataSource(bad.client, "t1").loadItems()).rejects.toThrow(/permission/);
  });
});

describe("updateField", () => {
  it("updates one column of one item in the tenant and asks for the row back", async () => {
    const { client, calls } = fake([{ data: [{ id: "i1" }] }]);
    const r = await new SupabaseDataSource(client, "t1").updateField("i1", "health", "At Risk");
    expect(r).toEqual({ ok: true });
    const c = calls[0]!;
    expect(has(c, "update", { health: "At Risk" })).toBe(true);
    expect(has(c, "eq", "tenant_id", "t1")).toBe(true);
    expect(has(c, "eq", "id", "i1")).toBe(true);
    expect(has(c, "select", "id")).toBe(true);
  });

  it("an update that touches no row is an error (no permission, or the item is gone)", async () => {
    const { client } = fake([{ data: [] }]);
    const r = await new SupabaseDataSource(client, "t1").updateField("i1", "initiative_name", "x");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/removed|cannot edit/);
  });

  it("an undo only happens if the stored value is still the expected one", async () => {
    const withValue = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(withValue.client, "t1").updateField("i1", "health", "On Track", { expected: "At Risk" });
    expect(has(withValue.calls[0]!, "eq", "health", "At Risk")).toBe(true);
    const withNull = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(withNull.client, "t1").updateField("i1", "moscow", "Must", { expected: null });
    expect(has(withNull.calls[0]!, "is", "moscow", null)).toBe(true);
    const lost = fake([{ data: [] }]);
    const r = await new SupabaseDataSource(lost.client, "t1").updateField("i1", "health", "x", { expected: "At Risk" });
    expect(r).toMatchObject({ ok: false, conflict: true });
  });

  it("maps database errors to plain words", async () => {
    const { client } = fake([{ error: { code: "23514", message: "check" } }]);
    const r = await new SupabaseDataSource(client, "t1").updateField("i1", "value_12m", -5);
    expect(r).toEqual({ ok: false, error: "that value is not allowed" });
  });
});

describe("column names", () => {
  it("writes the project field to home_project_id and every other field to its own column", async () => {
    const a = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(a.client, "t1").updateField("i1", "home_project", "p2");
    expect(has(a.calls[0]!, "update", { home_project_id: "p2" })).toBe(true);
    const b = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(b.client, "t1").updateField("i1", "home_project", "p1", { expected: "p2" });
    expect(has(b.calls[0]!, "eq", "home_project_id", "p2")).toBe(true);
    const c = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(c.client, "t1").updateField("i1", "product_manager", "u1");
    expect(has(c.calls[0]!, "update", { owner_user_id: "u1" })).toBe(true);
    const d = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(d.client, "t1").updateField("i1", "g2m_date_est", "2027-03-31");
    expect(has(d.calls[0]!, "update", { end_date: "2027-03-31" })).toBe(true);
  });
});

describe("createMany and deleteItems", () => {
  it("inserts all rows in one request with browser-chosen ids and returns what the database assigned", async () => {
    const { client, calls } = fake([{ data: [{ id: "n1", item_code: "R-12", stack_rank: "12" }, { id: "n2", item_code: "R-13", stack_rank: 13 }] }]);
    const r = await new SupabaseDataSource(client, "t1").createMany([
      { id: "n1", initiative_name: "Faster", home_project: "p1", product_manager: "u1", effort: "M", moscow: "Should" },
      { id: "n2", initiative_name: "Second", home_project: "p2", g2m_date_est: "2027-03-31", value_12m: 5 },
    ]);
    expect(r).toEqual({ ok: true, items: [{ id: "n1", item_code: "R-12", stack_rank: 12 }, { id: "n2", item_code: "R-13", stack_rank: 13 }] });
    expect(calls).toHaveLength(1);
    expect(has(calls[0]!, "insert", [
      { tenant_id: "t1", id: "n1", initiative_name: "Faster", home_project_id: "p1", owner_user_id: "u1", effort: "M", moscow: "Should" },
      { tenant_id: "t1", id: "n2", initiative_name: "Second", home_project_id: "p2", end_date: "2027-03-31", value_12m: 5 },
    ])).toBe(true);
  });
  it("an import is sent through the client that labels writes as import", async () => {
    const ui = fake([{ data: [] }]);
    const imp = fake([{ data: [{ id: "n1", item_code: "R-1", stack_rank: 1 }] }]);
    const src = new SupabaseDataSource(ui.client, "t1", imp.client);
    await src.createMany([{ id: "n1", initiative_name: "x", home_project: "p" }], { via: "import" });
    expect(ui.calls).toHaveLength(0);
    expect(imp.calls).toHaveLength(1);
    await src.createMany([{ id: "n2", initiative_name: "y", home_project: "p" }]);
    expect(ui.calls).toHaveLength(1);
  });
  it("turns an insert error into words", async () => {
    const { client } = fake([{ error: { code: "23514" } }]);
    expect(await new SupabaseDataSource(client, "t1").createMany([{ id: "n1", initiative_name: "x", home_project: "p" }])).toEqual({ ok: false, error: "that value is not allowed" });
  });
  it("deletes the items of the tenant in one request and notices when one was already gone", async () => {
    const { client, calls } = fake([{ data: [{ id: "n1" }, { id: "n2" }] }]);
    expect(await new SupabaseDataSource(client, "t1").deleteItems(["n1", "n2"])).toEqual({ ok: true });
    expect(has(calls[0]!, "eq", "tenant_id", "t1") && has(calls[0]!, "in", "id", ["n1", "n2"])).toBe(true);
    const gone = fake([{ data: [{ id: "n1" }] }]);
    expect(await new SupabaseDataSource(gone.client, "t1").deleteItems(["n1", "n2"])).toMatchObject({ ok: false });
  });
});

describe("moveItem and friendlyError", () => {
  it("calls the move_item function", async () => {
    const { client, calls } = fake([{}]);
    expect(await new SupabaseDataSource(client, "t1").moveItem("i1", 3)).toEqual({ ok: true });
    expect(calls[0]!.rpc).toBe("move_item");
    expect(calls[0]!.ops[0]![1]).toEqual([{ p_item: "i1", p_new_rank: 3 }]);
  });
  it("explains common errors", () => {
    expect(friendlyError({ code: "42501" })).toMatch(/permission/);
    expect(friendlyError({ code: "23503" })).toMatch(/does not exist/);
    expect(friendlyError({ message: "TypeError: Failed to fetch" })).toMatch(/connection/);
    expect(friendlyError(null)).toBe("unknown error");
  });
});
