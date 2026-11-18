import { describe, expect, it } from "vitest";
import { countLinkedInitiatives } from "./linked-counts";

const client = (tables: Record<string, unknown[]>, fail = false) => ({
  from: (t: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => (fail ? reject(new Error("boom")) : resolve({ data: tables[t] ?? [], error: null }));
    return c;
  },
}) as never;

describe("countLinkedInitiatives", () => {
  it("counts the initiatives of each project that have a Jira link", async () => {
    const m = await countLinkedInitiatives(client({ items: [{ id: "a", home_project_id: "p1" }, { id: "b", home_project_id: "p1" }, { id: "c", home_project_id: "p2" }], item_jira_links: [{ item_id: "a" }, { item_id: "c" }] }), "t", ["p1", "p2", "p3"]);
    expect([...m.entries()]).toEqual([["p1", 1], ["p2", 1]]);
  });
  it("is empty without projects or without items, and survives a failing read", async () => {
    expect((await countLinkedInitiatives(client({}), "t", [])).size).toBe(0);
    expect((await countLinkedInitiatives(client({ items: [] }), "t", ["p1"])).size).toBe(0);
    expect((await countLinkedInitiatives(client({}, true), "t", ["p1"])).size).toBe(0);
  });
});
