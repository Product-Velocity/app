import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError, MemorySourceControl, REMOVED_LABEL } from "@pv/github";

vi.mock("server-only", () => ({}));
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let recordFails = false;
let fromFn: (t: string) => unknown = () => { throw new Error("not set"); };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => fromFn(t), rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return { data: null, error: recordFails ? { message: "x" } : null }; } }) }));
vi.mock("./server", () => ({ githubSourceControl: () => { throw new Error("the real GitHub must not be reached in tests"); } }));

import { closeOne, listRemoved } from "./github-removed-engine";
import type { RemovedCtx } from "@/lib/tracker/removed-gate";

// A fake database that really applies .eq, .in and .not(is null) on its fixtures (so a missing mode filter would show), and fails a select of a column that is not there.
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let trash: Row[];
let missingColumns: string[];
function from(table: string) {
  let rows = tables[table] ?? [];
  let cols: string[] = [];
  const c: Record<string, unknown> = {
    select: (s: string) => { cols = s.split(",").map((x) => x.trim()); return c; },
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return c; },
    in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return c; },
    not: (k: string, _op: string, v: unknown) => { rows = rows.filter((r) => r[k] !== v); return c; },
    then: (ok: (v: unknown) => unknown) => ok(cols.some((x) => missingColumns.includes(x)) ? { data: null, error: { message: "column does not exist" } } : { data: rows.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]]))), error: null }),
  };
  return c;
}
const ctx: RemovedCtx = { supabase: { from, rpc: async (fn: string) => (fn === "trashed_items" ? { data: trash, error: null } : { data: null, error: { message: "unknown" } }) } as never, tenantId: "t1", userId: "u1" };

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333", D = "44444444-4444-4444-8444-444444444444";
const link = (item: string, n: number, o: Row = {}): Row => ({ tenant_id: "t1", item_id: item, connection_id: "c1", repo_full_name: "acme/road", issue_number: n, html_url: `https://github.com/acme/road/issues/${n}`, mode: "push", removed_handled_at: null, ...o });
const KEY = "acme/road#11";

/** A fake GitHub holding issue acme/road#11 (open, with a person's own label), plus anything a test adds. */
function fakeGithub(o: { state?: "open" | "closed"; reason?: string | null } = {}) {
  const sc = new MemorySourceControl();
  sc.issues.set("acme/road#11", { number: 11, id: 110, nodeId: "n11", htmlUrl: "https://github.com/acme/road/issues/11", body: "", state: o.state ?? "open", title: "Checkout", labels: ["bug", "pv:moscow/must"], stateReason: o.reason ?? null });
  return sc;
}
const WRITES = ["ensureLabels", "addLabels", "closeIssueNotPlanned", "createIssue", "updateIssue", "removeLabel", "setIssueAssignees"];
const written = (sc: MemorySourceControl) => sc.calls.filter((c) => WRITES.includes(c));

beforeEach(() => {
  fromFn = from;
  rpcCalls.length = 0; recordFails = false; missingColumns = [];
  trash = [{ id: A, item_code: "R-1", initiative_name: "Checkout" }, { id: B, item_code: "R-2", initiative_name: "Followed" }, { id: C, item_code: "R-3", initiative_name: "Handled" }, { id: D, item_code: "R-4", initiative_name: "Adopted" }];
  tables = {
    items: [{ tenant_id: "t1", id: A, source: "Created in the app" }, { tenant_id: "t1", id: B, source: "GitHub issue #12" }, { tenant_id: "t1", id: C, source: null }, { tenant_id: "t1", id: D, source: "GitHub issue #13" }],
    item_github_links: [link(A, 11), link(B, 12, { mode: "follow" }), link(C, 14, { removed_handled_at: "2026-11-01T10:00:00Z" }), link(D, 13), link("99999999-9999-4999-8999-999999999999", 15)],
    github_connections: [{ id: "c1", tenant_id: "t1", state: "connected", installation_id: 77 }],
    github_repositories: [{ tenant_id: "t1", connection_id: "c1", full_name: "acme/road", access: "read_write", removed_at: null }],
  };
});

describe("what is offered", () => {
  it("only Trash entries whose link is in push mode and not handled; a followed issue, a handled one and one outside the Trash are never offered", async () => {
    const sc = fakeGithub();
    sc.issues.set("acme/road#13", { ...sc.issues.get("acme/road#11")!, number: 13 });
    const r = await listRemoved(ctx, { sc });
    expect(r).toMatchObject({ ok: true, more: 0 });
    expect(r.ok && r.items.map((i) => i.id)).toEqual([A, D]);
    expect(written(sc)).toEqual([]); // only reads
  });
  it("marks an issue adopted from GitHub (the initiative's source is \"GitHub issue #N\"), so the preview warns; a created one is not marked", async () => {
    const sc = fakeGithub();
    sc.issues.set("acme/road#13", { ...sc.issues.get("acme/road#11")!, number: 13 });
    const r = await listRemoved(ctx, { sc });
    expect(r.ok && r.items.find((i) => i.id === D)).toMatchObject({ adopted: true });
    expect(r.ok && r.items.find((i) => i.id === A)!.adopted).toBeUndefined();
  });
  it("says what will happen: open or already closed (with how), nothing to choose", async () => {
    const open = await listRemoved(ctx, { sc: fakeGithub() });
    expect(open.ok && open.items[0]).toMatchObject({ tracker: "github", state: "ready", issueKey: KEY, trackerStatus: "open", alreadyDone: false, options: [], defaultTransitionId: null, issueUrl: "https://github.com/acme/road/issues/11" });
    const closed = await listRemoved(ctx, { sc: fakeGithub({ state: "closed", reason: "completed" }) });
    expect(closed.ok && closed.items[0]).toMatchObject({ alreadyDone: true, trackerStatus: "closed as completed" });
    const np = await listRemoved(ctx, { sc: fakeGithub({ state: "closed", reason: "not_planned" }) });
    expect(np.ok && np.items[0]!.trackerStatus).toBe("closed as not planned");
  });
  it("an issue GitHub does not return is shown as gone (nothing to close); nothing is written", async () => {
    const sc = new MemorySourceControl();
    const r = await listRemoved(ctx, { sc });
    expect(r.ok && r.items[0]).toMatchObject({ state: "gone" });
    expect(written(sc)).toEqual([]);
  });
  it("nothing is offered when the database cannot remember yet (migration not applied)", async () => {
    missingColumns = ["removed_handled_at"];
    const sc = fakeGithub();
    expect(await listRemoved(ctx, { sc })).toEqual({ ok: true, items: [], more: 0 });
    expect(sc.calls).toEqual([]);
  });
  it("a connection that is not usable, a repository marked read-only and one that was removed are shown with nothing to confirm, and GitHub is not reached", async () => {
    for (const change of [() => { tables.github_connections![0]!.state = "suspended"; }, () => { tables.github_connections![0]!.state = "disconnected"; }, () => { tables.github_repositories![0]!.access = "read_only"; }, () => { tables.github_repositories![0]!.removed_at = "2026-11-01T00:00:00Z"; }, () => { tables.github_repositories = []; }]) {
      beforeEachReset();
      change();
      const sc = fakeGithub();
      const r = await listRemoved(ctx, { sc });
      expect(r.ok && r.items[0]).toMatchObject({ state: "error" });
      expect(sc.calls).toEqual([]);
    }
  });
  it("the app that is not set up for this deployment is said, with nothing to confirm", async () => {
    const r = await listRemoved(ctx, { sc: null });
    expect(r.ok && r.items[0]).toMatchObject({ state: "error", message: expect.stringContaining("not set up") });
  });
  it("a sign-in that GitHub refuses is shown once and the reading stops", async () => {
    const sc = fakeGithub();
    sc.failNext = new GitHubError(401, "x");
    const r = await listRemoved(ctx, { sc });
    expect(r.ok && r.items[0]).toMatchObject({ state: "error", message: expect.stringContaining("Reconnect GitHub") });
  });
  it("cuts the list at 25 and says how many wait", async () => {
    trash = Array.from({ length: 30 }, (_, i) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`, item_code: `R-${i}`, initiative_name: `I${i}` }));
    tables.item_github_links = trash.map((t, i) => link(t.id as string, 100 + i));
    const r = await listRemoved(ctx, { sc: new MemorySourceControl() });
    expect(r.ok && r.items).toHaveLength(25);
    expect(r.ok && r.more).toBe(5);
  });
});
function beforeEachReset() {
  tables.github_connections = [{ id: "c1", tenant_id: "t1", state: "connected", installation_id: 77 }];
  tables.github_repositories = [{ tenant_id: "t1", connection_id: "c1", full_name: "acme/road", access: "read_write", removed_at: null }];
}

describe("closing one", () => {
  it("labels, closes as not planned, and records it; every other label stays; nothing else is written", async () => {
    const sc = fakeGithub();
    const r = await closeOne(ctx, A, { sc });
    expect(r.result).toMatchObject({ id: A, code: "R-1", outcome: "closed", issueLabel: KEY });
    expect(written(sc)).toEqual(["ensureLabels", "addLabels", "closeIssueNotPlanned"]);
    expect(sc.sent.filter((p) => Array.isArray(p) && typeof p[0] === "string")).toEqual([[REMOVED_LABEL]]); // the only labels written
    expect(sc.sent.find((p) => Array.isArray(p) && typeof p[0] === "object")).toEqual([{ name: REMOVED_LABEL, color: "2270ED", description: "Managed by Product Velocity: the initiative was removed" }]);
    expect(sc.sent.find((p) => typeof p === "object" && p !== null && "state" in p)).toEqual({ state: "closed", state_reason: "not_planned" });
    const issue = sc.issues.get("acme/road#11")!;
    expect(issue.labels).toEqual(["bug", "pv:moscow/must", "pv:removed"]);
    expect(issue).toMatchObject({ state: "closed", stateReason: "not_planned", title: "Checkout", body: "" }); // title and body untouched
    expect(sc.removed).toEqual([]);
    expect(rpcCalls).toEqual([{ fn: "github_record_removed", args: { p_actor: "u1", p_item: A, p_result: "closed", p_reason: "not_planned" } }]);
  });
  it("never touches a followed issue, one that is not in the Trash, or one already handled: nothing is read or written", async () => {
    for (const id of [B, C, "99999999-9999-4999-8999-999999999999"]) {
      const sc = fakeGithub();
      const r = await closeOne(ctx, id, { sc });
      expect(r.result.outcome).toBe("error");
      expect(sc.calls).toEqual([]);
    }
    expect(rpcCalls).toEqual([]);
  });
  it("an issue that is closed already is labelled only: not closed again, not reopened, the close reason is left as it was", async () => {
    const sc = fakeGithub({ state: "closed", reason: "completed" });
    const r = await closeOne(ctx, A, { sc });
    expect(r.result).toMatchObject({ outcome: "already_done", message: expect.stringContaining("closed as completed") });
    expect(written(sc)).toEqual(["ensureLabels", "addLabels"]);
    expect(sc.issues.get("acme/road#11")).toMatchObject({ state: "closed", stateReason: "completed" });
    expect(rpcCalls[0]!.args).toMatchObject({ p_result: "already_done", p_reason: null });
  });
  it("an issue GitHub does not return is recorded as not found: nothing is recreated and nothing is written", async () => {
    const sc = new MemorySourceControl();
    expect((await closeOne(ctx, A, { sc })).result.outcome).toBe("not_found");
    expect(written(sc)).toEqual([]);
    expect(rpcCalls[0]!.args.p_result).toBe("not_found");
  });
  it("GitHub refuses the close: the label stays, the refusal is shown, it is not recorded and not retried", async () => {
    const sc = fakeGithub();
    const orig = sc.closeIssueNotPlanned.bind(sc);
    let tries = 0;
    sc.closeIssueNotPlanned = async (...a) => { tries++; await orig(...a); throw new GitHubError(422, "x"); };
    const r = await closeOne(ctx, A, { sc });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("label pv:removed was added, but the issue was not closed") });
    expect(tries).toBe(1);
    expect(rpcCalls).toEqual([]);
  });
  it("a failing label write stops before the close and records nothing; missing permission says so", async () => {
    const sc = fakeGithub();
    sc.addLabels = async () => { throw new GitHubError(403, "x"); };
    const r = await closeOne(ctx, A, { sc });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("Issues permission") });
    expect(sc.calls).not.toContain("closeIssueNotPlanned");
    expect(sc.issues.get("acme/road#11")!.state).toBe("open");
    expect(rpcCalls).toEqual([]);
  });
  it("GitHub limiting requests: a short wait is waited out once, then it works; a long one stops with the time GitHub gave and writes nothing more", async () => {
    const sc = fakeGithub();
    const sleeps: number[] = [];
    sc.failNext = new GitHubError(429, "x", 3);
    expect((await closeOne(ctx, A, { sc, sleep: async (ms) => { sleeps.push(ms); } })).result.outcome).toBe("closed");
    expect(sleeps).toEqual([3000]);
    const slow = fakeGithub();
    slow.failNext = new GitHubError(403, "x", 120);
    const r = await closeOne(ctx, A, { sc: slow, sleep: async () => { throw new Error("must not wait two minutes"); } });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("about 120 seconds") });
    expect(written(slow)).toEqual([]);
  });
  it("an expired or refused installation token says to reconnect and stops", async () => {
    const sc = fakeGithub();
    sc.failNext = new Error("GitHub refused to create an installation token (401)");
    const r = await closeOne(ctx, A, { sc });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("Reconnect GitHub") });
    expect(written(sc)).toEqual([]);
  });
  it("GitHub was updated but the record failed: it says so (the next try finds the issue already done)", async () => {
    recordFails = true;
    const r = await closeOne(ctx, A, { sc: fakeGithub() });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("could not record") });
  });
  it("a repository marked read-only is never written to", async () => {
    tables.github_repositories![0]!.access = "read_only";
    const sc = fakeGithub();
    expect((await closeOne(ctx, A, { sc })).result.outcome).toBe("error");
    expect(sc.calls).toEqual([]);
  });
  it("without the migration it writes nothing", async () => {
    missingColumns = ["removed_handled_at"];
    const sc = fakeGithub();
    expect((await closeOne(ctx, A, { sc })).result.outcome).toBe("error");
    expect(sc.calls).toEqual([]);
  });
});

describe("an initiative stopped at a gate (issue #343)", () => {
  const E = "55555555-5555-4555-8555-555555555555", F = "66666666-6666-4666-8666-666666666666", G = "77777777-7777-4777-8777-777777777777";
  const decided = (item: string, outcome: string, at: string, gate = "B"): Row => ({ tenant_id: "t1", item_id: item, kind: "decision", gate, outcome, decided_at: at });
  beforeEach(() => {
    tables.items!.push({ tenant_id: "t1", id: E, item_code: "R-5", initiative_name: "Stopped", initiative_status: "Cancelled", source: "Created in the app" }, { tenant_id: "t1", id: F, item_code: "R-6", initiative_name: "Cancelled by hand", initiative_status: "Cancelled", source: null }, { tenant_id: "t1", id: G, item_code: "R-7", initiative_name: "Stopped then go", initiative_status: "Cancelled", source: null });
    tables.item_github_links!.push(link(E, 11, { issue_number: 21 }), link(F, 22), link(G, 23));
    tables.gate_reviews = [decided(E, "stop", "2027-04-02T10:00:00Z"), decided(G, "stop", "2027-04-01T10:00:00Z"), decided(G, "go", "2027-04-03T10:00:00Z"), { tenant_id: "t1", item_id: F, kind: "decision", gate: "A", outcome: null, decided_at: null }];
  });
  const sc21 = () => { const sc = fakeGithub(); sc.issues.set("acme/road#21", { ...sc.issues.get("acme/road#11")!, number: 21, htmlUrl: "https://github.com/acme/road/issues/21" }); return sc; };

  it("is offered like a removed one, with the gate it was stopped at; Cancelled by hand, an open request and a Stop that a later Go replaced are not", async () => {
    const r = await listRemoved(ctx, { sc: sc21() });
    expect(r.ok && r.items.map((i) => i.id)).toEqual([A, D, E]); // the Trash first, then the stopped one
    expect(r.ok && r.items.find((i) => i.id === E)).toMatchObject({ state: "ready", stopped: { gate: "B" }, code: "R-5" });
    expect(r.ok && r.items.find((i) => i.id === A)!.stopped).toBeUndefined();
  });

  it("never when its issue is only followed or was handled before", async () => {
    tables.item_github_links!.find((l) => l.item_id === E)!.mode = "follow";
    expect((await listRemoved(ctx, { sc: sc21() })).ok && (await listRemoved(ctx, { sc: sc21() }) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([A, D]);
    tables.item_github_links!.find((l) => l.item_id === E)!.mode = "push";
    tables.item_github_links!.find((l) => l.item_id === E)!.removed_handled_at = "2026-11-01T10:00:00Z";
    expect((await listRemoved(ctx, { sc: sc21() }) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([A, D]);
  });

  it("closing it writes only the fixed things: the label pv:removed and the close as not planned; nothing of the initiative; recorded once", async () => {
    const sc = sc21();
    const r = await closeOne(ctx, E, { sc });
    expect(r.result).toMatchObject({ id: E, outcome: "closed" });
    expect(written(sc).sort()).toEqual(["addLabels", "closeIssueNotPlanned", "ensureLabels"]);
    expect(sc.issues.get("acme/road#21")).toMatchObject({ state: "closed", stateReason: "not_planned" });
    expect(sc.issues.get("acme/road#21")!.labels).toContain(REMOVED_LABEL);
    expect(rpcCalls).toEqual([{ fn: "github_record_removed", args: { p_actor: "u1", p_item: E, p_result: "closed", p_reason: "not_planned" } }]);
  });

  it("is refused when it is Cancelled by hand or the Stop was replaced: nothing is read or written", async () => {
    for (const id of [F, G]) {
      const sc = sc21();
      const r = await closeOne(ctx, id, { sc });
      expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("not stopped at a gate") });
      expect(sc.calls).toEqual([]);
    }
  });

  it("a gate read that fails offers no stopped initiative and the Trash list still works", async () => {
    missingColumns = ["outcome"];
    const r = await listRemoved(ctx, { sc: sc21() });
    expect(r.ok && r.items.map((i) => i.id)).toEqual([A, D]);
  });
});
