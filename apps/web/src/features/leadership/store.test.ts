import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryLeadershipStore, SupabaseLeadershipStore } from "./store";

type Call = { table?: string; rpc?: string; ops: [string, unknown[]][] };
function fake(responses: { data?: unknown; error?: unknown }[]) {
  const calls: Call[] = [];
  const make = (call: Call) => {
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") { const res = responses.shift() ?? { data: [] }; return (resolve: (v: unknown) => void) => resolve({ data: res.data ?? null, error: res.error ?? null }); }
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
const rowOf = (o: Record<string, unknown> = {}) => ({ id: "w1", week_start: "2026-10-19", scope_key: "all", scope_label: "All projects", body: "Text", reviewed_at: null, reviewed_by: null, ...o });

describe("SupabaseLeadershipStore", () => {
  it("reads the week's changes through the function, for this workspace", async () => {
    const { client, calls } = fake([{ data: [{ item_id: "i1", field: "health", old: "On Track", new: "At Risk", at: "2026-10-20T10:00:00Z", actor_id: "u1", via: "UI" }] }]);
    expect(await new SupabaseLeadershipStore(client, "t1").loadChanges("2026-10-19T00:00:00Z")).toEqual([{ itemId: "i1", field: "health", old: "On Track", new: "At Risk", at: "2026-10-20T10:00:00Z", actorId: "u1", via: "UI" }]);
    expect(calls[0]).toMatchObject({ rpc: "weekly_item_changes" });
    expect(calls[0]!.ops[0]![1]).toEqual([{ p_tenant: "t1", p_since: "2026-10-19T00:00:00Z" }]);
  });
  it("finds the update of a week and scope in this workspace, or null", async () => {
    const { client, calls } = fake([{ data: rowOf({ reviewed_at: "2026-10-22T10:00:00Z", reviewed_by: "u2" }) }, { data: null }]);
    const s = new SupabaseLeadershipStore(client, "t1");
    expect(await s.getUpdate("2026-10-19", "all")).toMatchObject({ id: "w1", reviewedAt: "2026-10-22T10:00:00Z", reviewedBy: "u2" });
    expect(has(calls[0]!, "eq", "tenant_id", "t1") && has(calls[0]!, "eq", "week_start", "2026-10-19") && has(calls[0]!, "eq", "scope_key", "all")).toBe(true);
    expect(await s.getUpdate("2026-10-12", "all")).toBeNull();
  });
  it("saveDraft inserts the first time and updates the text after", async () => {
    const first = fake([{ data: null }, { data: [rowOf()] }]);
    expect(await new SupabaseLeadershipStore(first.client, "t1").saveDraft("2026-10-19", "all", "All projects", "Text")).toMatchObject({ ok: true, value: { body: "Text" } });
    expect(has(first.calls[1]!, "insert", { tenant_id: "t1", week_start: "2026-10-19", scope_key: "all", scope_label: "All projects", body: "Text" })).toBe(true);
    const again = fake([{ data: { id: "w1" } }, { data: [rowOf({ body: "New" })] }]);
    await new SupabaseLeadershipStore(again.client, "t1").saveDraft("2026-10-19", "all", "All projects", "New");
    expect(has(again.calls[1]!, "update", { body: "New", scope_label: "All projects" })).toBe(true);
    expect(has(again.calls[1]!, "eq", "id", "w1")).toBe(true);
  });
  it("explains a refusal in words, for readers who may not write", async () => {
    const { client } = fake([{ data: null }, { data: [] }]);
    expect(await new SupabaseLeadershipStore(client, "t1").saveDraft("2026-10-19", "all", "All projects", "x")).toMatchObject({ ok: false, error: expect.stringContaining("only creators and admins") });
    expect(await new SupabaseLeadershipStore(fake([{ error: { code: "PV004" } }]).client, "t1").markReviewed("w1")).toEqual({ ok: false, error: "Claude cannot mark an update as reviewed." });
  });
  it("markReviewed sends only the time; the database sets who", async () => {
    const { client, calls } = fake([{ data: [rowOf({ reviewed_at: "2026-10-22T10:00:00Z", reviewed_by: "u1" })] }]);
    const r = await new SupabaseLeadershipStore(client, "t1").markReviewed("w1");
    expect(r).toMatchObject({ ok: true, value: { reviewedBy: "u1" } });
    const upd = calls[0]!.ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>;
    expect(Object.keys(upd)).toEqual(["reviewed_at"]);
  });
});

describe("MemoryLeadershipStore", () => {
  it("editing the text clears the review, like the database", async () => {
    const s = new MemoryLeadershipStore();
    const a = await s.saveDraft("2026-10-19", "all", "All", "v1");
    expect(a.ok && (await s.markReviewed(a.value.id))).toMatchObject({ ok: true, value: { reviewedBy: "u1" } });
    await s.saveDraft("2026-10-19", "all", "All", "v2");
    expect(await s.getUpdate("2026-10-19", "all")).toMatchObject({ body: "v2", reviewedAt: null, reviewedBy: null });
    s.writable = false;
    expect(await s.saveDraft("2026-10-19", "all", "All", "v3")).toMatchObject({ ok: false });
  });
});
