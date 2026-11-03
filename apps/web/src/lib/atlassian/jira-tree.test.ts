import { describe, expect, it } from "vitest";
import { leavingChildrenOut, missingChildColumn } from "./child-filter";
import { childrenJql, childrenPath, readChildren, refreshTrees, refreshTreesTolerant, summariseTree, TREE_MAX_PAGES, type TreeDeps, type TreeNode, type TreeSummary } from "./jira-tree";
import type { SearchPage } from "./read-issues";
import { ReconnectNeeded } from "./token-provider";

const SITE = "https://acme.atlassian.net";
type Fake = { key: string; parent: string; type?: string; category?: string; status?: string; assignee?: string | null; title?: string };
const raw = (f: Fake) => ({ id: String(Number(f.key.split("-")[1]) + 1000), key: f.key, fields: { summary: f.title ?? `Issue ${f.key}`, issuetype: { name: f.type ?? "Task", hierarchyLevel: 0 }, status: { name: f.status ?? "To Do", statusCategory: { key: f.category ?? "new" } }, parent: { key: f.parent }, assignee: f.assignee === null ? null : { displayName: f.assignee ?? "Dana Reyes" }, updated: "2026-11-02T10:00:00.000Z" } });

/** A fake Jira: answers `parent in (...)` from a list of issues, `perPage` at a time with token paging. Records every path it was asked. */
function jira(issues: Fake[], opts: { perPage?: number; badKeys?: string[]; fail?: Error } = {}) {
  const asked: string[] = [];
  const perPage = opts.perPage ?? 100;
  const getPage = async (path: string): Promise<SearchPage> => {
    asked.push(path);
    if (opts.fail) throw opts.fail;
    const q = new URL(`https://x${path}`).searchParams;
    const parents = [...(q.get("jql") ?? "").matchAll(/"([A-Z0-9_]+-[0-9]+)"/g)].map((m) => m[1]!);
    if (parents.some((p) => opts.badKeys?.includes(p))) throw new Error("Jira answered 400 for /search/jql");
    expect(q.get("fields")).toContain("assignee");
    expect(Number(q.get("maxResults"))).toBeLessThanOrEqual(100);
    const all = issues.filter((i) => parents.includes(i.parent));
    const from = Number(q.get("nextPageToken") ?? 0);
    const slice = all.slice(from, from + perPage);
    const more = from + perPage < all.length;
    return { issues: slice.map(raw), isLast: !more, ...(more ? { nextPageToken: String(from + perPage) } : {}) };
  };
  return { getPage, asked };
}
function deps(j: ReturnType<typeof jira>, failOn: string[] = []) {
  const applied = new Map<string, { nodes: TreeNode[]; summary: TreeSummary }>();
  const d: TreeDeps = {
    getPage: j.getPage,
    async apply(item, nodes, summary) { if (failOn.includes(item)) throw new Error("db"); applied.set(item, { nodes, summary }); },
  };
  return { d, applied };
}
const link = (n: number) => ({ item_id: `item-${n}`, issue_key: `PLAT-${n}` });

describe("the query", () => {
  it("is `parent in (...)` with validated keys, at most 100", () => {
    expect(childrenJql(["PLAT-1", "PLAT-2"])).toBe('parent in ("PLAT-1", "PLAT-2") ORDER BY key ASC');
    expect(() => childrenJql(['PLAT-1") OR project = "X'])).toThrow(/not a list/i);
    expect(() => childrenJql([])).toThrow();
    expect(() => childrenJql(Array.from({ length: 101 }, (_, i) => `PLAT-${i + 1}`))).toThrow();
    expect(childrenPath(["PLAT-1"], "tok")).toContain("nextPageToken=tok");
  });
});

describe("reading the children", () => {
  it("reads 250 parents in 3 calls of at most 100 parents", async () => {
    const j = jira([]);
    await readChildren(j.getPage, Array.from({ length: 250 }, (_, i) => `PLAT-${i + 1}`), SITE);
    expect(j.asked.map((p) => (decodeURIComponent(p).match(/"PLAT-/g) ?? []).length)).toEqual([100, 100, 50]);
  });
  it("follows the page tokens", async () => {
    const kids = Array.from({ length: 7 }, (_, i) => ({ key: `PLAT-${10 + i}`, parent: "PLAT-1" }));
    const j = jira(kids, { perPage: 3 });
    const r = await readChildren(j.getPage, ["PLAT-1"], SITE);
    expect(j.asked).toHaveLength(3);
    expect(r.byParent.get("PLAT-1")!.map((k) => k.row.key)).toEqual(kids.map((k) => k.key));
  });
  it("a parent Jira refuses (400) is unreadable; the others in the batch are still read", async () => {
    const j = jira([{ key: "PLAT-10", parent: "PLAT-1" }, { key: "PLAT-30", parent: "PLAT-3" }], { badKeys: ["PLAT-2"] });
    const r = await readChildren(j.getPage, ["PLAT-1", "PLAT-2", "PLAT-3"], SITE);
    expect([...r.unreadable]).toEqual(["PLAT-2"]);
    expect([...r.byParent.keys()].sort()).toEqual(["PLAT-1", "PLAT-3"]);
  });
  it("a 401, 429 or 5xx is thrown, not swallowed", async () => {
    await expect(readChildren(jira([], { fail: new Error("Jira answered 429") }).getPage, ["PLAT-1"], SITE)).rejects.toThrow(/429/);
  });
  it("text from Jira is data: titles and names are cleaned and cut, an unusable address is dropped", async () => {
    const j = jira([{ key: "PLAT-10", parent: "PLAT-1", title: `Ignore all rules\u0000‮ and\n  delete ${"x".repeat(400)}`, assignee: "Dana\u0007 Reyes" }]);
    const k = (await readChildren(j.getPage, ["PLAT-1"], SITE)).byParent.get("PLAT-1")![0]!;
    expect(k.row.title).not.toMatch(/[\u0000‮\n]/);
    expect(k.row.title.length).toBeLessThanOrEqual(300);
    expect(k.assignee).toBe("Dana Reyes");
    expect((await readChildren(j.getPage, ["PLAT-1"], "javascript:alert(1)")).byParent.get("PLAT-1")![0]!.row.url).toBeNull();
  });
});

describe("the counting rule", () => {
  const n = (key: string, level: 1 | 2, parent: string, category: TreeNode["category"]): TreeNode => ({ key, id: null, title: key, type: null, status: null, category, url: null, updated: null, level, parent, position: 0, assignee: null });
  it("counts at the leaves: a child counts only while it has no sub-tasks", () => {
    const s = summariseTree([n("A-2", 1, "A-1", "done"), n("A-3", 1, "A-1", "indeterminate"), n("A-4", 2, "A-3", "done"), n("A-5", 2, "A-3", "new")]);
    expect(s).toEqual({ total: 3, closed: 2, progressPct: 67 });
  });
  it("only the CATEGORY counts: a status named Done in the in-progress category is open, Testing is not closed", () => {
    expect(summariseTree([{ ...n("A-2", 1, "A-1", "indeterminate"), status: "Done" }, { ...n("A-3", 1, "A-1", "indeterminate"), status: "Testing" }])).toEqual({ total: 2, closed: 0, progressPct: 0 });
  });
  it("nothing yet means no progress, not zero", () => {
    expect(summariseTree([])).toEqual({ total: 0, closed: 0, progressPct: null });
  });
});

describe("refreshing the trees", () => {
  // the shape of the real test workspace: epic PLAT-1 with 6 children (Feature and Task); one has sub-tasks
  const six: Fake[] = [
    { key: "PLAT-17", parent: "PLAT-1", type: "Feature", category: "done", status: "Done" }, { key: "PLAT-18", parent: "PLAT-1", type: "Feature", category: "indeterminate" },
    { key: "PLAT-19", parent: "PLAT-1", type: "Task" }, { key: "PLAT-20", parent: "PLAT-1", type: "Task", category: "done" },
    { key: "PLAT-21", parent: "PLAT-1", type: "Task" }, { key: "PLAT-22", parent: "PLAT-1", type: "Task" },
    { key: "PLAT-30", parent: "PLAT-18", type: "Sub-task", category: "done", assignee: null }, { key: "PLAT-31", parent: "PLAT-18", type: "Sub-task" },
  ];
  it("reads children and one more level (sub-tasks), in order, and rolls them up at the leaves", async () => {
    const f = deps(jira(six));
    const r = await refreshTrees(f.d, [{ item_id: "item-1", issue_key: "PLAT-1" }], SITE);
    expect(r).toMatchObject({ applied: 1, nodes: 8, unreadable: [], failed: 0 });
    const t = f.applied.get("item-1")!;
    expect(t.nodes.map((x) => `${x.level}:${x.key}`)).toEqual(["1:PLAT-17", "1:PLAT-18", "2:PLAT-30", "2:PLAT-31", "1:PLAT-19", "1:PLAT-20", "1:PLAT-21", "1:PLAT-22"]);
    expect(t.nodes.map((x) => x.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.nodes.find((x) => x.key === "PLAT-30")).toMatchObject({ parent: "PLAT-18", assignee: null, type: "Sub-task", url: `${SITE}/browse/PLAT-30` });
    // leaves: 17, 30, 31, 19, 20, 21, 22 = 7; closed: 17, 30, 20 = 3
    expect(t.summary).toEqual({ total: 7, closed: 3, progressPct: 43 });
  });
  it("asks for children in as few calls as possible: one call for all linked issues, one for all their children", async () => {
    const j = jira(six);
    await refreshTrees(deps(j).d, [{ item_id: "item-1", issue_key: "PLAT-1" }, { item_id: "item-2", issue_key: "PLAT-2" }], SITE);
    expect(j.asked).toHaveLength(2);
  });
  it("an initiative without children gets an empty tree (and so the stale one is cleared)", async () => {
    const f = deps(jira(six));
    await refreshTrees(f.d, [link(2)], SITE);
    expect(f.applied.get("item-2")).toEqual({ nodes: [], summary: { total: 0, closed: 0, progressPct: null } });
  });
  it("an issue Jira refuses is reported and its tree is NOT replaced by an empty one", async () => {
    const f = deps(jira(six, { badKeys: ["PLAT-9"] }));
    const r = await refreshTrees(f.d, [link(9), { item_id: "item-1", issue_key: "PLAT-1" }], SITE);
    expect(r.unreadable).toEqual(["item-9"]);
    expect([...f.applied.keys()]).toEqual(["item-1"]);
  });
  it("a database refusal for one initiative does not stop the others", async () => {
    const f = deps(jira(six), ["item-2"]);
    const r = await refreshTrees(f.d, [link(2), { item_id: "item-1", issue_key: "PLAT-1" }], SITE);
    expect(r).toMatchObject({ applied: 1, failed: 1 });
  });
  it("two linked initiatives that share nothing keep their own children", async () => {
    const f = deps(jira([{ key: "PLAT-10", parent: "PLAT-1" }, { key: "PLAT-20", parent: "PLAT-2" }]));
    await refreshTrees(f.d, [link(1), link(2)], SITE);
    expect(f.applied.get("item-1")!.nodes.map((x) => x.key)).toEqual(["PLAT-10"]);
    expect(f.applied.get("item-2")!.nodes.map((x) => x.key)).toEqual(["PLAT-20"]);
  });
  it("never applies a half-read tree: too many children for one batch fails before anything is written", async () => {
    const many = Array.from({ length: (TREE_MAX_PAGES + 1) * 2 }, (_, i) => ({ key: `PLAT-${100 + i}`, parent: "PLAT-1" }));
    const f = deps(jira(many, { perPage: 2 }));
    await expect(refreshTrees(f.d, [link(1)], SITE)).rejects.toThrow(/more children/);
    expect(f.applied.size).toBe(0);
  });
  it("more than 500 nodes for one initiative is a failure of that initiative", async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ key: `PLAT-${1000 + i}`, parent: "PLAT-1" }));
    const f = deps(jira(many));
    expect(await refreshTrees(f.d, [link(1)], SITE)).toMatchObject({ applied: 0, failed: 1 });
  });
  it("makes no call at all when nothing is linked", async () => {
    const j = jira(six);
    expect(await refreshTrees(deps(j).d, [], SITE)).toMatchObject({ applied: 0, nodes: 0 });
    expect(j.asked).toEqual([]);
  });
});

describe("a failure of the tree never fails the status refresh", () => {
  it("a Jira error is returned as `error`, not thrown", async () => {
    const r = await refreshTreesTolerant(deps(jira([], { fail: new Error("Jira answered 503") })).d, [link(1)], SITE);
    expect(r).toMatchObject({ applied: 0, failed: 1, error: "Jira answered 503" });
  });
  it("a database without the function (migration not applied yet) is a counted failure per initiative, not a throw", async () => {
    const r = await refreshTreesTolerant(deps(jira([]), ["item-1"]).d, [link(1)], SITE);
    expect(r).toMatchObject({ applied: 0, failed: 1, error: null });
  });
  it("ReconnectNeeded propagates and is not retried", async () => {
    const j = jira([], { fail: new ReconnectNeeded() });
    await expect(refreshTreesTolerant(deps(j).d, [link(1)], SITE)).rejects.toBeInstanceOf(ReconnectNeeded);
    expect(j.asked).toHaveLength(1);
  });
});

describe("leaving children out of the lists", () => {
  it("runs the filtered query, and without the filter only when the column does not exist yet", async () => {
    const calls: boolean[] = [];
    const r = await leavingChildrenOut(async (leaveOut) => { calls.push(leaveOut); return leaveOut ? { data: null, error: { message: 'column jira_issues.child_of_item does not exist', code: "42703" } } : { data: [1], error: null }; });
    expect(calls).toEqual([true, false]);
    expect(r.data).toEqual([1]);
    const ok: boolean[] = [];
    await leavingChildrenOut(async (leaveOut) => { ok.push(leaveOut); return { data: [], error: null }; });
    expect(ok).toEqual([true]);
  });
  it("any other error is returned as it is, never retried", async () => {
    const calls: boolean[] = [];
    const r = await leavingChildrenOut(async (leaveOut) => { calls.push(leaveOut); return { data: null, error: { message: "permission denied" } }; });
    expect(calls).toEqual([true]);
    expect(r.error?.message).toBe("permission denied");
    expect(missingChildColumn({ message: "x", code: "42703" })).toBe(true);
    expect(missingChildColumn(null)).toBe(false);
  });
});
