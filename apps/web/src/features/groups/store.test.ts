import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryGroupsStore, SupabaseGroupsStore, type MergeReceipt } from "./store";

const rpcClient = (reply: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message?: string } | null }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); const r = reply(fn, args); return { data: r.data ?? null, error: r.error ?? null }; } } as unknown as SupabaseClient;
  return { client, calls };
};

describe("SupabaseGroupsStore", () => {
  it("lists groups with counts for this workspace", async () => {
    const { client, calls } = rpcClient(() => ({ data: [{ id: "g1", name: "Growth", items: "4" }] }));
    expect(await new SupabaseGroupsStore(client, "t1").list()).toEqual([{ id: "g1", name: "Growth", items: 4 }]);
    expect(calls[0]).toEqual({ fn: "item_group_usage", args: { p_tenant: "t1" } });
  });
  it("renames with a cleaned name and says how many initiatives changed", async () => {
    const { client, calls } = rpcClient(() => ({ data: 3 }));
    expect(await new SupabaseGroupsStore(client, "t1").rename("g1", "  New   name ")).toEqual({ ok: true, value: 3 });
    expect(calls[0]!.args).toEqual({ p_group: "g1", p_name: "New name" });
    expect(await new SupabaseGroupsStore(client, "t1").rename("g1", "  ")).toEqual({ ok: false, error: "Type a group name." });
  });
  it("explains a duplicate name and a non-admin", async () => {
    expect(await new SupabaseGroupsStore(rpcClient(() => ({ error: { code: "23505" } })).client, "t1").rename("g1", "X")).toEqual({ ok: false, error: "There is already a group with that name." });
    expect(await new SupabaseGroupsStore(rpcClient(() => ({ error: { code: "42501" } })).client, "t1").retire("g1")).toEqual({ ok: false, error: "Only admins can change groups." });
  });
  it("merge returns a receipt (names and moved items) that undo sends back", async () => {
    const { client, calls } = rpcClient((fn) => (fn === "item_group_usage" ? { data: [{ id: "a", name: "Loops", items: 2 }, { id: "b", name: "Growth", items: 5 }] } : fn === "merge_item_groups" ? { data: ["i1", "i2"] } : { data: 2 }));
    const s = new SupabaseGroupsStore(client, "t1");
    const m = await s.merge("a", "b");
    expect(m).toEqual({ ok: true, value: { from: "Loops", into: "Growth", itemIds: ["i1", "i2"] } });
    expect(await s.undoMerge((m as { value: { from: string; into: string; itemIds: string[] } }).value)).toEqual({ ok: true, value: 2 });
    expect(calls.at(-1)).toEqual({ fn: "restore_merged_group", args: { p_tenant: "t1", p_name: "Loops", p_into_name: "Growth", p_items: ["i1", "i2"] } });
  });
});

describe("MemoryGroupsStore", () => {
  it("renames, merges (and undoes), and retires only unused groups", async () => {
    const s = new MemoryGroupsStore([{ name: "Growth", items: 2 }, { name: "Loops", items: 1 }, { name: "Empty" }]);
    const [empty, growth, loops] = await s.list(); // A to Z: Empty, Growth, Loops
    expect(await s.rename(growth!.id, "loops")).toEqual({ ok: false, error: "There is already a group with that name." });
    expect(await s.retire(growth!.id)).toMatchObject({ ok: false });
    expect(await s.retire(empty!.id)).toEqual({ ok: true, value: null });
    const m = await s.merge(loops!.id, growth!.id);
    expect((await s.list()).map((g) => [g.name, g.items])).toEqual([["Growth", 3]]);
    await s.undoMerge((m as { ok: true; value: MergeReceipt }).value);
    expect((await s.list()).map((g) => [g.name, g.items])).toEqual([["Growth", 2], ["Loops", 1]]);
  });
  it("refuses non-admins", async () => {
    const s = new MemoryGroupsStore([{ name: "A" }]); s.admin = false;
    expect(await s.retire((await s.list())[0]!.id)).toEqual({ ok: false, error: "Only admins can change groups." });
  });
});
