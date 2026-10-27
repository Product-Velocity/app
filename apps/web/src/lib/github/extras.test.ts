import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { refreshExtras, newExtrasCache } = await import("./extras");
const { ingestDeliveryEvent } = await import("./delivery-events");
const { MemorySourceControl } = await import("@pv/github");

type Rpc = { name: string; args: Record<string, unknown> };
type Tables = { link?: Record<string, unknown> | null; tree?: unknown[]; item?: Record<string, unknown> | null; conn?: Record<string, unknown> | null; links?: unknown[]; nodes?: unknown[] };

/** A stand-in for the admin client: reads come from the tables below, every filter and rpc is recorded. */
function fakeAdmin(t: Tables) {
  const rpcs: Rpc[] = [];
  const reads: { table: string; filters: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    const rows = (): unknown => {
      if (table === "item_github_links") return t.links ?? (t.link ? [t.link] : []);
      if (table === "item_issue_tree") return t.nodes ?? t.tree ?? [];
      if (table === "items") return t.item ? [t.item] : [];
      if (table === "github_connections") return t.conn ? [t.conn] : [];
      return [];
    };
    for (const m of ["select", "not", "limit"]) q[m] = () => q;
    for (const m of ["eq", "ilike", "in"]) q[m] = (k: string, v: unknown) => { filters[k] = v; return q; };
    q.maybeSingle = async () => { reads.push({ table, filters }); return { data: (rows() as unknown[])[0] ?? null, error: null }; };
    q.then = (resolve: (v: unknown) => void) => { reads.push({ table, filters }); resolve({ data: rows(), error: null }); };
    return { select: () => q };
  };
  return { rpcs, reads, from, rpc: async (name: string, args: Record<string, unknown>) => { rpcs.push({ name, args }); return { data: true, error: null }; } } as never;
}
const rpcsOf = (a: unknown) => (a as { rpcs: Rpc[] }).rpcs;
const readsOf = (a: unknown) => (a as { reads: { table: string; filters: Record<string, unknown> }[] }).reads;

const link = { tenant_id: "t1", repo_full_name: "Acme/api", issue_number: 10 };
const tree = [{ repo_full_name: "Acme/api", issue_number: 11 }, { repo_full_name: "Acme/web", issue_number: 4 }];

describe("refreshExtras", () => {
  it("counts the pull requests of the initiative's issues, reads CI on the primary repository and the latest release, and stores them", async () => {
    const sc = new MemorySourceControl();
    sc.linkedPrs.set("Acme/api#10", [{ repo: "Acme/api", number: 1, state: "open" }, { repo: "Acme/api", number: 2, state: "merged" }]);
    sc.linkedPrs.set("Acme/web#4", [{ repo: "Acme/api", number: 1, state: "open" }, { repo: "Acme/web", number: 3, state: "merged" }, { repo: "Acme/web", number: 5, state: "closed" }]);
    sc.rollups.set("Acme/api", "SUCCESS");
    sc.releases.set("Acme/web", [{ repo: "Acme/web", tag: "v2.0.0", name: null, publishedAt: "2026-10-20T08:00:00Z" }]);
    sc.releases.set("Acme/api", [{ repo: "Acme/api", tag: "v1.9.0", name: null, publishedAt: "2026-09-01T08:00:00Z" }]);
    const admin = fakeAdmin({ link, tree, item: { start_building: "2026-10-01" } });
    expect(await refreshExtras(admin, sc, 9, "c1", "i1")).toBe(true);
    expect(rpcsOf(admin)[0]).toEqual({ name: "github_apply_extras", args: { p_connection: "c1", p_item: "i1", p_open: 1, p_merged: 2, p_ci: "Passing", p_release: "Acme/web v2.0.0 · 2026-10-20", p_repos: "Acme/api, Acme/web" } });
  });
  it("every read after the link is scoped to the workspace of that link", async () => {
    const admin = fakeAdmin({ link, tree, item: null });
    await refreshExtras(admin, new MemorySourceControl(), 9, "c1", "i1");
    for (const r of readsOf(admin).filter((x) => x.table === "item_issue_tree" || x.table === "items")) expect(r.filters).toMatchObject({ tenant_id: "t1" });
    expect(readsOf(admin).find((x) => x.table === "item_github_links")?.filters).toMatchObject({ connection_id: "c1", item_id: "i1" });
  });
  it("a check still running leaves the CI value, no checks is None, and a failing read stores nothing at all", async () => {
    const running = new MemorySourceControl(); running.rollups.set("Acme/api", "PENDING");
    const a = fakeAdmin({ link, tree: [], item: null });
    await refreshExtras(a, running, 9, "c1", "i1");
    expect(rpcsOf(a)[0]!.args.p_ci).toBeNull();
    const none = fakeAdmin({ link, tree: [], item: null });
    await refreshExtras(none, new MemorySourceControl(), 9, "c1", "i1");
    expect(rpcsOf(none)[0]!.args).toMatchObject({ p_ci: "None", p_open: 0, p_merged: 0, p_release: null });
    const broken = new MemorySourceControl(); broken.failOn = "listLinkedPullRequests";
    const b = fakeAdmin({ link, tree: [], item: null });
    expect(await refreshExtras(b, broken, 9, "c1", "i1")).toBe(false);
    expect(rpcsOf(b)).toEqual([]); // the values shown stay as they were
  });
  it("a release before the item started is not shown", async () => {
    const sc = new MemorySourceControl();
    sc.releases.set("Acme/api", [{ repo: "Acme/api", tag: "v1", name: null, publishedAt: "2026-01-01T00:00:00Z" }]);
    const admin = fakeAdmin({ link, tree: [], item: { start_building: "2026-10-01" } });
    await refreshExtras(admin, sc, 9, "c1", "i1");
    expect(rpcsOf(admin)[0]!.args.p_release).toBeNull();
  });
  it("reads each repository's checks and releases once for a whole pass", async () => {
    const sc = new MemorySourceControl();
    const cache = newExtrasCache();
    for (const id of ["i1", "i2", "i3"]) await refreshExtras(fakeAdmin({ link, tree: [], item: null }), sc, 9, "c1", id, cache);
    expect(sc.calls.filter((c) => c === "getDefaultBranchRollup")).toHaveLength(1);
    expect(sc.calls.filter((c) => c === "listReleases")).toHaveLength(1);
    expect(sc.calls.filter((c) => c === "listLinkedPullRequests")).toHaveLength(3); // pull requests are per initiative
  });
  it("an initiative without an issue, or without a link, is skipped", async () => {
    const sc = new MemorySourceControl();
    expect(await refreshExtras(fakeAdmin({ link: { ...link, issue_number: null } }), sc, 9, "c1", "i1")).toBe(false);
    expect(await refreshExtras(fakeAdmin({ link: null }), sc, 9, "c1", "i1")).toBe(false);
    expect(sc.calls).toEqual([]);
  });
});

describe("ingestDeliveryEvent", () => {
  const conn = { id: "c1", tenant_id: "t1" };
  const ev = { installationId: 9, repo: "Acme/api" };
  it("a pull request refreshes the initiatives of the issues it closes", async () => {
    const sc = new MemorySourceControl();
    sc.closing.set("Acme/api#40", [{ repo: "Acme/api", number: 11 }]);
    const admin = fakeAdmin({ conn, links: [], nodes: [{ item_id: "i1", repo_full_name: "Acme/api", issue_number: 11 }] });
    // the initiative's link, found by item for the refresh
    const withLink = fakeAdmin({ conn, links: [{ ...link, item_id: "i1" }], nodes: [{ item_id: "i1", repo_full_name: "Acme/api", issue_number: 11 }] });
    expect(await ingestDeliveryEvent(admin, sc, { kind: "pull_request", action: "closed", number: 40, ...ev })).toBe("processed");
    expect(sc.calls).toContain("getClosingIssues");
    expect(await ingestDeliveryEvent(withLink, sc, { kind: "pull_request", action: "closed", number: 40, ...ev })).toBe("processed");
    expect(rpcsOf(withLink)[0]).toMatchObject({ name: "github_apply_extras", args: { p_connection: "c1", p_item: "i1" } });
  });
  it("a pull request that closes nothing of ours, and actions that change nothing, are ignored", async () => {
    const sc = new MemorySourceControl();
    expect(await ingestDeliveryEvent(fakeAdmin({ conn, links: [], nodes: [] }), sc, { kind: "pull_request", action: "closed", number: 41, ...ev })).toBe("ignored");
    expect(await ingestDeliveryEvent(fakeAdmin({ conn }), sc, { kind: "pull_request", action: "labeled", number: 41, ...ev })).toBe("ignored");
    expect(sc.calls.filter((c) => c === "getClosingIssues")).toHaveLength(1); // the ignored action never asked GitHub
  });
  it("only a finished check suite on the default branch counts", async () => {
    const sc = new MemorySourceControl();
    const base = { kind: "check_suite" as const, ...ev, defaultBranch: "main" };
    expect(await ingestDeliveryEvent(fakeAdmin({ conn, links: [link] }), sc, { ...base, action: "requested", headBranch: "main" })).toBe("ignored");
    expect(await ingestDeliveryEvent(fakeAdmin({ conn, links: [link] }), sc, { ...base, action: "completed", headBranch: "feature/x" })).toBe("ignored");
    expect(await ingestDeliveryEvent(fakeAdmin({ conn, links: [link] }), sc, { ...base, action: "completed", headBranch: "main" })).toBe("processed");
  });
  it("a published release refreshes the initiatives in that repository; other actions are ignored", async () => {
    const sc = new MemorySourceControl();
    expect(await ingestDeliveryEvent(fakeAdmin({ conn, links: [link] }), sc, { kind: "release", action: "published", ...ev })).toBe("processed");
    expect(await ingestDeliveryEvent(fakeAdmin({ conn, links: [link] }), sc, { kind: "release", action: "created", ...ev })).toBe("ignored");
  });
  it("an installation that is not connected to a workspace is ignored, and nothing is read from GitHub", async () => {
    const sc = new MemorySourceControl();
    expect(await ingestDeliveryEvent(fakeAdmin({ conn: null }), sc, { kind: "release", action: "published", ...ev })).toBe("ignored");
    expect(sc.calls).toEqual([]);
  });
  it("is scoped to the connection and its workspace when it looks for initiatives", async () => {
    const sc = new MemorySourceControl();
    const admin = fakeAdmin({ conn, links: [link], nodes: [{ item_id: "i1" }] });
    await ingestDeliveryEvent(admin, sc, { kind: "release", action: "published", ...ev });
    expect(readsOf(admin).find((r) => r.table === "item_github_links" && "repo_full_name" in r.filters)?.filters).toMatchObject({ connection_id: "c1" });
    expect(readsOf(admin).find((r) => r.table === "item_issue_tree" && "repo_full_name" in r.filters)?.filters).toMatchObject({ tenant_id: "t1" });
  });
});
