import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { ingestIssueEvent, retryEvent, reconcileConnection } = await import("./sync");
const { MemorySourceControl } = await import("@pv/github");

type Call = { table: string; op: string; payload?: unknown };

/** A tiny stand-in for the admin client: tables return what the test set, every write is recorded. */
function fakeAdmin(opts: { connection?: unknown; link?: unknown; links?: unknown[]; insertError?: { code: string; message: string } | null; rpcError?: string | null; rpcResult?: unknown; event?: unknown }) {
  const calls: Call[] = [];
  const chain = (table: string, op: string, payload?: unknown) => {
    const q: Record<string, unknown> = {};
    const result = () => {
      if (op === "insert") return opts.insertError ? { data: null, error: opts.insertError } : { data: { id: "evt-1" }, error: null };
      if (table === "github_connections") return { data: opts.connection ?? null, error: null };
      if (table === "item_github_links" && op === "select") return { data: opts.link ?? null, error: null };
      if (table === "sync_events" && op === "select") return { data: opts.event ?? null, error: null };
      return { data: null, error: null };
    };
    for (const m of ["eq", "neq", "ilike", "is", "not", "in", "select", "limit", "lt"]) q[m] = () => q;
    q.maybeSingle = async () => result();
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => void) => resolve(table === "item_github_links" && op === "select" && opts.links ? { data: opts.links, error: null } : { data: null, error: null });
    return { ...q, __record: () => calls.push({ table, op, payload }) };
  };
  const client = {
    calls,
    from: (table: string) => ({
      select: () => chain(table, "select"),
      insert: (p: unknown) => { calls.push({ table, op: "insert", payload: p }); return chain(table, "insert", p); },
      update: (p: unknown) => { calls.push({ table, op: "update", payload: p }); return chain(table, "update", p); },
    }),
    rpc: async (name: string, args: unknown) => { calls.push({ table: name, op: "rpc", payload: args }); return opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: opts.rpcResult ?? { item_id: "i1", stale: false, changes: { status: ["Backlog", "Completed"] } }, error: null }; },
  };
  return client as unknown as Parameters<typeof ingestIssueEvent>[0] & { calls: Call[] };
}

const ev = { action: "closed", installationId: 9, repo: "Acme/App", number: 31, issueId: 5, nodeId: "I_x", state: "closed" as const, stateReason: "completed", updatedAt: "2026-10-23T10:00:00Z", closedAt: "2026-10-23T09:59:00Z" };
const conn = { id: "c1", tenant_id: "t1" };
const link = { id: "l1", item_id: "i1" };

describe("ingestIssueEvent", () => {
  it("stores the delivery once and applies it", async () => {
    const admin = fakeAdmin({ connection: conn, link });
    expect(await ingestIssueEvent(admin, ev, "d-1")).toBe("processed");
    const inserted = admin.calls.find((c) => c.op === "insert")!.payload as Record<string, unknown>;
    expect(inserted).toMatchObject({ delivery_id: "d-1", tenant_id: "t1", issue_number: 31, source: "webhook" });
    expect(JSON.stringify(inserted)).not.toMatch(/title|body|login/i);
    expect(admin.calls.find((c) => c.op === "rpc")?.payload).toMatchObject({ p_state: "closed", p_state_reason: "completed", p_number: 31 });
    expect(admin.calls.filter((c) => c.op === "update").pop()?.payload).toMatchObject({ state: "processed" });
  });
  it("records when the ticket closed as Build Completed, and clears it when the issue is reopened", async () => {
    const admin = fakeAdmin({ connection: conn, link });
    await ingestIssueEvent(admin, ev, "d-5");
    expect(admin.calls.filter((c) => c.table === "item_github_links" && c.op === "update").pop()?.payload).toEqual({ gh_closed_at: "2026-10-23T09:59:00Z" });
    const reopened = fakeAdmin({ connection: conn, link });
    await ingestIssueEvent(reopened, { ...ev, action: "reopened", state: "open", stateReason: null, closedAt: null }, "d-6");
    expect(reopened.calls.filter((c) => c.table === "item_github_links" && c.op === "update").pop()?.payload).toEqual({ gh_closed_at: null });
  });
  it("a replayed delivery is a duplicate and applies nothing", async () => {
    const admin = fakeAdmin({ connection: conn, link, insertError: { code: "23505", message: "duplicate key" } });
    expect(await ingestIssueEvent(admin, ev, "d-1")).toBe("duplicate");
    expect(admin.calls.some((c) => c.op === "rpc")).toBe(false);
  });
  it("an issue nobody links, or an unknown installation, is ignored and not stored", async () => {
    const noLink = fakeAdmin({ connection: conn, link: null });
    expect(await ingestIssueEvent(noLink, ev, "d-2")).toBe("ignored");
    expect(noLink.calls.some((c) => c.op === "insert")).toBe(false);
    const noConn = fakeAdmin({ connection: null });
    expect(await ingestIssueEvent(noConn, ev, "d-3")).toBe("ignored");
  });
  it("a failure is kept in the sync log with a short message instead of being lost", async () => {
    const admin = fakeAdmin({ connection: conn, link, rpcError: "boom ".repeat(100) });
    expect(await ingestIssueEvent(admin, ev, "d-4")).toBe("error");
    const last = admin.calls.filter((c) => c.op === "update").pop()!.payload as { state: string; last_error: string };
    expect(last.state).toBe("error");
    expect(last.last_error.length).toBeLessThanOrEqual(280);
  });
});

describe("retryEvent", () => {
  const event = { id: "e1", connection_id: "c1", attempts: 1, state: "error", summary: { repo: "Acme/App", number: 31, issueId: 5, nodeId: "I_x", state: "closed", stateReason: "completed", updatedAt: "2026-10-23T10:00:00Z" } };
  it("applies the stored facts again and counts the attempt", async () => {
    const admin = fakeAdmin({ event });
    expect(await retryEvent(admin, "t1", "e1")).toBe(true);
    expect(admin.calls.filter((c) => c.op === "update").pop()?.payload).toMatchObject({ state: "processed", attempts: 2 });
  });
  it("does nothing for an event that already worked or does not exist", async () => {
    expect(await retryEvent(fakeAdmin({ event: { ...event, state: "processed" } }), "t1", "e1")).toBe(false);
    expect(await retryEvent(fakeAdmin({ event: null }), "t1", "e1")).toBe(false);
  });
});

describe("reconcileConnection", () => {
  const connection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" as const };
  it("compares GitHub with every linked item, flags a missing issue and logs only what changed", async () => {
    const sc = new MemorySourceControl();
    sc.listed.set("Acme/App", [{ number: 31, id: 5, nodeId: "I_x", state: "closed", stateReason: "completed", updatedAt: "2026-10-23T10:00:00Z", closedAt: "2026-10-23T10:00:00Z" }]);
    const admin = fakeAdmin({ links: [{ id: "l1", item_id: "i1", repo_full_name: "Acme/App", issue_number: 31 }, { id: "l2", item_id: "i2", repo_full_name: "Acme/App", issue_number: 404 }] });
    const r = await reconcileConnection(admin, sc, connection);
    expect(r).toEqual({ checked: 2, changed: 1, missing: 1, repos: 1 });
    expect(admin.calls.filter((c) => c.op === "rpc" && c.table === "github_apply_issue")).toHaveLength(1);
    expect(admin.calls.filter((c) => c.op === "rpc" && c.table === "github_apply_tree")).toHaveLength(1); // the epics and tasks of the linked item are read again
    expect(admin.calls.find((c) => c.table === "sync_events" && c.op === "insert")?.payload).toMatchObject({ source: "reconcile", issue_number: 31 });
    expect(admin.calls.filter((c) => c.table === "item_github_links" && c.op === "update").map((c) => c.payload)).toEqual(expect.arrayContaining([{ gh_closed_at: "2026-10-23T10:00:00Z" }, expect.objectContaining({ sync_state: "error" })]));
  });
  it("an unchanged issue is applied but leaves no log entry", async () => {
    const sc = new MemorySourceControl();
    sc.listed.set("Acme/App", [{ number: 31, id: 5, nodeId: "I_x", state: "open", stateReason: null, updatedAt: "2026-10-23T10:00:00Z", closedAt: null }]);
    const admin = fakeAdmin({ links: [{ id: "l1", item_id: "i1", repo_full_name: "Acme/App", issue_number: 31 }], rpcResult: { item_id: "i1", stale: false, changes: {} } });
    expect(await reconcileConnection(admin, sc, connection)).toEqual({ checked: 1, changed: 0, missing: 0, repos: 1 });
    expect(admin.calls.some((c) => c.table === "sync_events")).toBe(false);
  });
});

describe("refreshTree", () => {
  it("stores the tree with one counting rule and reports false when sub-issues are unavailable", async () => {
    const { refreshTree } = await import("./sync");
    const sc = new MemorySourceControl();
    const sub = (number: number, state: "open" | "closed") => ({ number, id: number, repo: "Acme/App", title: `t${number}`, state, stateReason: null, closedAt: null, assignees: ["dev"], createdBy: "engineer" as const });
    sc.subs.set("Acme/App#31", [sub(40, "open")]);
    sc.subs.set("Acme/App#40", [sub(41, "closed"), sub(42, "open")]);
    const admin = fakeAdmin({});
    expect(await refreshTree(admin, sc, 9, "c1", { item_id: "i1", repo: "Acme/App", number: 31 })).toBe(true);
    expect(admin.calls.find((c) => c.table === "github_apply_tree")?.payload).toMatchObject({ p_item: "i1", p_total: 2, p_closed: 1, p_pct: 50 });
    sc.subs.set("Acme/App#31", null);
    expect(await refreshTree(admin, sc, 9, "c1", { item_id: "i1", repo: "Acme/App", number: 31 })).toBe(false);
  });
});
