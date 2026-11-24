import { describe, expect, it } from "vitest";
import { refreshAttachedEpics, type EpicTreeDeps } from "./epic-tree";
import type { SearchPage } from "./read-issues";

// Read-only epics (issue #656): epics listed on an initiative that has no Jira issue are read by key, with their children, into the read-only tree.
const SITE = "https://x.atlassian.net";
const issue = (key: string, o: { level: number; cat: "new" | "indeterminate" | "done"; parent?: string; type?: string }) => ({
  id: String(1000 + Number(key.split("-")[1])),
  key,
  fields: { summary: `Title ${key}`, issuetype: { name: o.type ?? (o.level === 1 ? "Epic" : "Story"), hierarchyLevel: o.level }, status: { name: o.cat === "done" ? "Done" : "Doing", statusCategory: { key: o.cat } }, ...(o.parent ? { parent: { key: o.parent } } : {}), updated: "2026-11-20T10:00:00.000+0000" },
});

function fake(issues: ReturnType<typeof issue>[]): { deps: EpicTreeDeps; applied: { item: string; nodes: { key: string; level: number; parent: string }[]; summary: unknown; category: string | null }[]; calls: string[] } {
  const applied: { item: string; nodes: { key: string; level: number; parent: string }[]; summary: unknown; category: string | null }[] = [];
  const calls: string[] = [];
  const deps: EpicTreeDeps = {
    async getPage(path): Promise<SearchPage> {
      calls.push(decodeURIComponent(path));
      const jql = new URL(`https://x${path}`).searchParams.get("jql") ?? "";
      const keys = [...jql.matchAll(/"([A-Z][A-Z0-9_]+-\d+)"/g)].map((m) => m[1]!);
      const found = jql.startsWith("parent in") ? issues.filter((i) => i.fields.parent && keys.includes(i.fields.parent.key)) : issues.filter((i) => keys.includes(i.key));
      return { issues: found as never, isLast: true };
    },
    async apply(item, nodes, summary, category) { applied.push({ item, nodes, summary, category }); },
  };
  return { deps, applied, calls };
}

describe("refreshAttachedEpics", () => {
  it("reads each listed epic and its children, counts at the leaves and derives the category from the epics", async () => {
    const { deps, applied } = fake([
      issue("R8P-1", { level: 1, cat: "indeterminate" }), issue("R8P-2", { level: 1, cat: "new" }),
      issue("R8P-10", { level: 0, cat: "done", parent: "R8P-1" }), issue("R8P-11", { level: 0, cat: "new", parent: "R8P-1" }), issue("R8P-12", { level: 0, cat: "new", parent: "R8P-2" }),
    ]);
    const out = await refreshAttachedEpics(deps, [{ item_id: "i1", keys: ["R8P-1", "R8P-2"] }], SITE);
    expect(out).toMatchObject({ applied: 1, nodes: 5, failed: 0, notEpics: {}, missing: {} });
    const a = applied[0]!;
    expect(a.category).toBe("indeterminate");
    expect(a.summary).toEqual({ total: 3, closed: 1, progressPct: 33 });
    expect(a.nodes.filter((n) => n.level === 1).map((n) => [n.key, n.parent])).toEqual([["R8P-1", "R8P-1"], ["R8P-2", "R8P-2"]]);
    expect(a.nodes.filter((n) => n.level === 2).map((n) => [n.key, n.parent])).toEqual([["R8P-10", "R8P-1"], ["R8P-11", "R8P-1"], ["R8P-12", "R8P-2"]]);
  });
  it("an epic with no children counts as one piece of work; all epics done gives the done category", async () => {
    const { deps, applied } = fake([issue("R8P-1", { level: 1, cat: "done" }), issue("R8P-2", { level: 1, cat: "done" })]);
    await refreshAttachedEpics(deps, [{ item_id: "i1", keys: ["R8P-1", "R8P-2"] }], SITE);
    expect(applied[0]!.category).toBe("done");
    expect(applied[0]!.summary).toEqual({ total: 2, closed: 2, progressPct: 100 });
  });
  it("only epics are tree nodes: a key that is not at epic level is reported and left out; a missing key is reported", async () => {
    const { deps, applied } = fake([issue("R8P-1", { level: 1, cat: "new" }), issue("R8P-5", { level: 0, cat: "new", type: "Story" })]);
    const out = await refreshAttachedEpics(deps, [{ item_id: "i1", keys: ["R8P-1", "R8P-5", "R8P-9"] }], SITE);
    expect(applied[0]!.nodes.map((n) => n.key)).toEqual(["R8P-1"]);
    expect(out.notEpics).toEqual({ i1: ["R8P-5"] });
    expect(out.missing).toEqual({ i1: ["R8P-9"] });
  });
  it("when none of the keys can be read nothing is applied (the tree is left as it was, never emptied by a failed read)", async () => {
    const { deps, applied } = fake([]);
    const out = await refreshAttachedEpics(deps, [{ item_id: "i1", keys: ["R8P-9"] }], SITE);
    expect(applied).toHaveLength(0);
    expect(out).toMatchObject({ applied: 0, missing: { i1: ["R8P-9"] } });
  });
  it("two initiatives are read in the same calls and applied one each", async () => {
    const { deps, applied, calls } = fake([issue("R8P-1", { level: 1, cat: "new" }), issue("R8P-2", { level: 1, cat: "done" }), issue("R8P-20", { level: 0, cat: "done", parent: "R8P-2" })]);
    await refreshAttachedEpics(deps, [{ item_id: "a", keys: ["R8P-1"] }, { item_id: "b", keys: ["R8P-2"] }], SITE);
    expect(applied.map((x) => [x.item, x.category])).toEqual([["a", "new"], ["b", "done"]]);
    expect(calls.length).toBe(2); // the epics by key (both initiatives together), then their children in one batch, and nothing else
  });
  it("a database refusal counts as failed for that initiative only", async () => {
    const { deps } = fake([issue("R8P-1", { level: 1, cat: "new" }), issue("R8P-2", { level: 1, cat: "new" })]);
    const real = deps.apply;
    deps.apply = async (item, ...rest) => { if (item === "a") throw new Error("refused"); return real(item, ...rest); };
    const out = await refreshAttachedEpics(deps, [{ item_id: "a", keys: ["R8P-1"] }, { item_id: "b", keys: ["R8P-2"] }], SITE);
    expect(out).toMatchObject({ applied: 1, failed: 1, failedItems: ["a"] });
  });
  it("never builds a write request: only GET-style search paths are produced", async () => {
    const { deps, calls } = fake([issue("R8P-1", { level: 1, cat: "new" })]);
    await refreshAttachedEpics(deps, [{ item_id: "a", keys: ["R8P-1"] }], SITE);
    expect(calls.every((c) => c.startsWith("/search/jql?"))).toBe(true);
  });
});
