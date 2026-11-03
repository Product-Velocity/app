import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraRequest } from "./jira-write";

vi.mock("server-only", () => ({}));
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let recordFails = false;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return { data: null, error: recordFails ? { message: "x" } : null }; } }) }));
vi.mock("./server", () => ({ jiraRequest: () => { throw new Error("the real Jira must not be reached in tests"); } }));

import { closeOne, listRemoved } from "./jira-removed-engine";
import type { Ctx } from "./jira-sync-engine";

// A fake database that really applies .eq and .in on its fixtures (so a missing mode filter would show), and fails a select of a column that is not there.
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
    then: (ok: (v: unknown) => unknown) => ok(cols.some((x) => missingColumns.includes(x)) ? { data: null, error: { message: "column does not exist" } } : { data: rows.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]]))), error: null }),
  };
  return c;
}
const ctx: Ctx = { supabase: { from, rpc: async (fn: string) => (fn === "trashed_items" ? { data: trash, error: null } : { data: null, error: { message: "unknown" } }) } as never, tenantId: "t1", userId: "u1" };

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const link = (item: string, key: string, o: Row = {}): Row => ({ tenant_id: "t1", item_id: item, connection_id: "c1", site_id: "s1", issue_key: key, html_url: `https://acme.example.test/browse/${key}`, mode: "push", removed_handled_at: null, ...o });
const T = (id: string, name: string, toId: string, toName: string, cat: string) => ({ id, name, to: { id: toId, name: toName, statusCategory: { key: cat } } });
const DONE1 = [T("31", "Done", "10001", "Done", "done")];
const DONE2 = [...DONE1, T("41", "Won't do", "10002", "Won't do", "done")];

type Hit = { method: string; path: string; body?: unknown };
function fakeJira(o: { transitions?: unknown[]; cat?: string; statusName?: string; put?: number; post?: number; postJson?: unknown; get?: number } = {}) {
  const hits: Hit[] = [];
  const call: JiraRequest = async (method, path, body) => {
    hits.push({ method, path, body });
    if (method === "GET" && path.endsWith("/transitions")) return { status: 200, json: { transitions: o.transitions ?? DONE1 } };
    if (method === "GET") return o.get ? { status: o.get, json: {} } : { status: 200, json: { fields: { status: { name: o.statusName ?? "In Progress", statusCategory: { key: o.cat ?? "indeterminate" } }, labels: [] } } };
    if (method === "PUT") return { status: o.put ?? 204, json: {} };
    return { status: o.post ?? 204, json: o.postJson ?? {} };
  };
  return { call, hits };
}
const writes = (h: Hit[]) => h.filter((x) => x.method !== "GET");

beforeEach(() => {
  rpcCalls.length = 0; recordFails = false; missingColumns = [];
  trash = [{ id: A, item_code: "R-1", initiative_name: "Checkout" }, { id: B, item_code: "R-2", initiative_name: "Came from Jira" }, { id: C, item_code: "R-3", initiative_name: "Handled" }];
  tables = {
    item_jira_links: [link(A, "PLAT-1"), link(B, "PLAT-2", { mode: "follow" }), link(C, "PLAT-3", { removed_handled_at: "2026-11-01T10:00:00Z" }), link("99999999-9999-4999-8999-999999999999", "PLAT-9")],
    jira_connections: [{ id: "c1", tenant_id: "t1", state: "connected", sites: [{ id: "s1", name: "Acme", url: "https://acme.example.test" }] }],
    jira_project_links: [{ tenant_id: "t1", connection_id: "c1", site_id: "s1", jira_project_key: "PLAT", removed_close_status_id: null }],
  };
});

describe("what is offered", () => {
  it("only Trash entries whose link is in push mode and not handled; a link that follows Jira, a handled one and one outside the Trash are never offered", async () => {
    const j = fakeJira();
    const r = await listRemoved(ctx, { call: j.call });
    expect(r).toMatchObject({ ok: true, more: 0 });
    expect(r.ok && r.items.map((i) => i.id)).toEqual([A]);
    expect(j.hits.map((h) => h.path)).toEqual(["/issue/PLAT-1?fields=status,labels", "/issue/PLAT-1/transitions"]); // only reads
    expect(writes(j.hits)).toEqual([]);
  });
  it("says what will happen: the Done transitions, the current status, a default when there is one", async () => {
    const one = await listRemoved(ctx, { call: fakeJira().call });
    expect(one.ok && one.items[0]).toMatchObject({ state: "ready", jiraStatus: "In Progress", alreadyDone: false, options: [{ id: "31", toStatusName: "Done" }], defaultTransitionId: "31" });
    const many = await listRemoved(ctx, { call: fakeJira({ transitions: DONE2 }).call });
    expect(many.ok && many.items[0]).toMatchObject({ options: [{ id: "31" }, { id: "41" }], defaultTransitionId: null });
    (tables.jira_project_links![0]!).removed_close_status_id = "10002"; // the choice made before for this Jira project
    const remembered = await listRemoved(ctx, { call: fakeJira({ transitions: DONE2 }).call });
    expect(remembered.ok && remembered.items[0]!.defaultTransitionId).toBe("41");
    const none = await listRemoved(ctx, { call: fakeJira({ transitions: [] }).call });
    expect(none.ok && none.items[0]).toMatchObject({ options: [], defaultTransitionId: null });
  });
  it("nothing is offered when the database cannot remember yet (migration not applied); the project's remembered choice may be missing", async () => {
    missingColumns = ["removed_handled_at"];
    const j = fakeJira();
    expect(await listRemoved(ctx, { call: j.call })).toEqual({ ok: true, items: [], more: 0 });
    expect(j.hits).toEqual([]);
    missingColumns = ["removed_close_status_id"];
    const r = await listRemoved(ctx, { call: fakeJira().call });
    expect(r.ok && r.items.map((i) => i.id)).toEqual([A]);
  });
  it("a Jira that needs a new sign-in is shown, with nothing to confirm", async () => {
    (tables.jira_connections![0]!).state = "reconnect_needed";
    const j = fakeJira();
    const r = await listRemoved(ctx, { call: j.call });
    expect(r.ok && r.items[0]).toMatchObject({ state: "error" });
    expect(j.hits).toEqual([]);
  });
  it("cuts the list at 25 and says how many wait", async () => {
    trash = Array.from({ length: 30 }, (_, i) => { const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`; return { id, item_code: `R-${i}`, initiative_name: `I${i}` }; });
    tables.item_jira_links = trash.map((t, i) => link(t.id as string, `PLAT-${i + 1}`));
    const r = await listRemoved(ctx, { call: fakeJira().call });
    expect(r.ok && r.items).toHaveLength(25);
    expect(r.ok && r.more).toBe(5);
  });
});

describe("closing one", () => {
  it("labels, moves to the Done status, and records it; the record carries the status for the project", async () => {
    const j = fakeJira();
    const r = await closeOne(ctx, A, null, { call: j.call });
    expect(r.result).toMatchObject({ id: A, code: "R-1", outcome: "closed", issueLabel: "PLAT-1" });
    expect(writes(j.hits)).toEqual([
      { method: "PUT", path: "/issue/PLAT-1", body: { update: { labels: [{ add: "pv:removed" }] } } },
      { method: "POST", path: "/issue/PLAT-1/transitions", body: { transition: { id: "31" } } },
    ]);
    expect(rpcCalls).toEqual([{ fn: "jira_record_removed", args: { p_actor: "u1", p_item: A, p_result: "closed", p_status_name: "Done", p_status_id: "10001" } }]);
  });
  it("never touches an issue that came from Jira, one that is not in the Trash, or one already handled: nothing is read or written", async () => {
    for (const id of [B, C, "99999999-9999-4999-8999-999999999999"]) {
      const j = fakeJira();
      const r = await closeOne(ctx, id, "31", { call: j.call });
      expect(r.result.outcome).toBe("error");
      expect(j.hits).toEqual([]);
    }
    expect(rpcCalls).toEqual([]);
  });
  it("several Done statuses and no choice: nothing is written; the chosen one is used; one that is not a Done transition is refused before any write", async () => {
    const a = fakeJira({ transitions: DONE2 });
    expect((await closeOne(ctx, A, null, { call: a.call })).result).toMatchObject({ outcome: "error", message: expect.stringContaining("Choose") });
    expect(writes(a.hits)).toEqual([]);
    const b = fakeJira({ transitions: DONE2 });
    expect((await closeOne(ctx, A, "41", { call: b.call })).result.outcome).toBe("closed");
    expect(writes(b.hits)[1]).toEqual({ method: "POST", path: "/issue/PLAT-1/transitions", body: { transition: { id: "41" } } });
    const c = fakeJira({ transitions: [...DONE1, T("11", "Start", "3", "In Progress", "indeterminate")] });
    expect((await closeOne(ctx, A, "11", { call: c.call })).result.outcome).toBe("error");
    expect(writes(c.hits)).toEqual([]);
    expect(rpcCalls.map((r) => r.args.p_status_id)).toEqual(["10002"]);
  });
  it("no Done transition: only the label, and it says so", async () => {
    const j = fakeJira({ transitions: [] });
    const r = await closeOne(ctx, A, null, { call: j.call });
    expect(r.result).toMatchObject({ outcome: "labeled", message: expect.stringContaining("only the label") });
    expect(writes(j.hits)).toEqual([{ method: "PUT", path: "/issue/PLAT-1", body: { update: { labels: [{ add: "pv:removed" }] } } }]);
    expect(rpcCalls[0]!.args.p_result).toBe("labeled");
  });
  it("an issue already in a Done status is labelled and not transitioned", async () => {
    const j = fakeJira({ cat: "done", statusName: "Done" });
    const r = await closeOne(ctx, A, null, { call: j.call });
    expect(r.result.outcome).toBe("already_done");
    expect(writes(j.hits).map((h) => h.method)).toEqual(["PUT"]);
  });
  it("Jira refuses the transition: the label stays, the refusal is shown, it is not recorded and not retried", async () => {
    const j = fakeJira({ post: 400, postJson: { errors: { resolution: "Resolution is required" } } });
    const r = await closeOne(ctx, A, null, { call: j.call });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("Resolution is required") });
    expect(r.result.message).toContain("label pv:removed was added");
    expect(writes(j.hits).filter((h) => h.method === "POST")).toHaveLength(1);
    expect(rpcCalls).toEqual([]);
  });
  it("a failing label write stops before the transition and records nothing", async () => {
    const j = fakeJira({ put: 403 });
    expect((await closeOne(ctx, A, null, { call: j.call })).result.outcome).toBe("error");
    expect(writes(j.hits).map((h) => h.method)).toEqual(["PUT"]);
    expect(rpcCalls).toEqual([]);
  });
  it("an issue Jira does not return is recorded as not found: there is nothing to close, and it is not offered again", async () => {
    const j = fakeJira({ get: 404 });
    expect((await closeOne(ctx, A, null, { call: j.call })).result.outcome).toBe("not_found");
    expect(writes(j.hits)).toEqual([]);
    expect(rpcCalls[0]!.args.p_result).toBe("not_found");
  });
  it("Jira was updated but the record failed: it says so (the next try finds the issue already done)", async () => {
    recordFails = true;
    const r = await closeOne(ctx, A, null, { call: fakeJira().call });
    expect(r.result).toMatchObject({ outcome: "error", message: expect.stringContaining("could not record") });
  });
  it("without the migration it writes nothing", async () => {
    missingColumns = ["removed_handled_at"];
    const j = fakeJira();
    expect((await closeOne(ctx, A, null, { call: j.call })).result.outcome).toBe("error");
    expect(j.hits).toEqual([]);
  });
});
