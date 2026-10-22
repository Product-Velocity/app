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

const row = (i: number) => ({ id: `i${i}`, key: `R-${i}`, title: "t", stack_rank: i, home_project_id: "p", owner_user_id: null, moscow: null, size: null, health: null, value: "1200.50", confidence: 5, start_date: null, end_date: null, status: null, delivery_progress: "40.00" });

describe("loadItems", () => {
  it("reads every page, filtered by tenant and cycle, in rank order", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => row(i + 1));
    const page2 = Array.from({ length: 300 }, (_, i) => row(PAGE_SIZE + i + 1));
    const { client, calls } = fake([{ data: page1 }, { data: page2 }]);
    const items = await new SupabaseDataSource(client, "t1").loadItems();
    expect(items).toHaveLength(1300);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.table).toBe("items");
      expect(has(c, "eq", "tenant_id", "t1")).toBe(true);
      expect(has(c, "is", "cycle_id", null)).toBe(true);
      expect(has(c, "order", "stack_rank", { ascending: true })).toBe(true);
    }
    expect(has(calls[0]!, "range", 0, PAGE_SIZE - 1)).toBe(true);
    expect(has(calls[1]!, "range", PAGE_SIZE, 2 * PAGE_SIZE - 1)).toBe(true);
  });

  it("turns numeric strings into numbers", async () => {
    const { client } = fake([{ data: [row(1)] }]);
    const [item] = await new SupabaseDataSource(client, "t1").loadItems();
    expect([item!.value, item!.delivery_progress, item!.confidence]).toEqual([1200.5, 40, 5]);
  });

  it("stops after one short page, and fails with a readable message", async () => {
    const one = fake([{ data: [row(1)] }]);
    await new SupabaseDataSource(one.client, "t1").loadItems();
    expect(one.calls).toHaveLength(1);
    const bad = fake([{ error: { code: "42501", message: "denied" } }]);
    await expect(new SupabaseDataSource(bad.client, "t1").loadItems()).rejects.toThrow(/permission/);
  });
});

describe("updateField", () => {
  it("updates one column of one item in the tenant and asks for the row back", async () => {
    const { client, calls } = fake([{ data: [{ id: "i1" }] }]);
    const r = await new SupabaseDataSource(client, "t1").updateField("i1", "health", "at_risk");
    expect(r).toEqual({ ok: true });
    const c = calls[0]!;
    expect(has(c, "update", { health: "at_risk" })).toBe(true);
    expect(has(c, "eq", "tenant_id", "t1")).toBe(true);
    expect(has(c, "eq", "id", "i1")).toBe(true);
    expect(has(c, "select", "id")).toBe(true);
  });

  it("an update that touches no row is an error (no permission, or the item is gone)", async () => {
    const { client } = fake([{ data: [] }]);
    const r = await new SupabaseDataSource(client, "t1").updateField("i1", "title", "x");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/removed|cannot edit/);
  });

  it("an undo only happens if the stored value is still the expected one", async () => {
    const withValue = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(withValue.client, "t1").updateField("i1", "health", "on_track", { expected: "at_risk" });
    expect(has(withValue.calls[0]!, "eq", "health", "at_risk")).toBe(true);
    const withNull = fake([{ data: [{ id: "i1" }] }]);
    await new SupabaseDataSource(withNull.client, "t1").updateField("i1", "moscow", "must", { expected: null });
    expect(has(withNull.calls[0]!, "is", "moscow", null)).toBe(true);
    const lost = fake([{ data: [] }]);
    const r = await new SupabaseDataSource(lost.client, "t1").updateField("i1", "health", "x", { expected: "at_risk" });
    expect(r).toMatchObject({ ok: false, conflict: true });
  });

  it("maps database errors to plain words", async () => {
    const { client } = fake([{ error: { code: "23514", message: "check" } }]);
    const r = await new SupabaseDataSource(client, "t1").updateField("i1", "value", -5);
    expect(r).toEqual({ ok: false, error: "that value is not allowed" });
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
