import { beforeEach, describe, expect, it, vi } from "vitest";
import { markdownToAdf } from "./adf";
import type { JiraRequest } from "./jira-write";

vi.mock("server-only", () => ({}));
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcFail: string | null = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return fn === rpcFail ? { data: null, error: { message: "x" } } : { data: fn === "jira_apply_pull" ? { initiative_name: "Old", description: null } : null, error: null }; } }) }));
vi.mock("./server", () => ({ jiraRequest: () => { throw new Error("the real Jira must not be reached in tests"); } }));

import { evaluate, previewParts, writeOne, type Ctx } from "./jira-sync-engine";
import { hashText } from "@pv/github";
import { adfToText } from "./adf";

// A fake database: each table answers with its fixture whatever the filters are (the real filtering is row-level security).
let tables: Record<string, unknown>;
const chain = (table: string) => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq", "is", "in"]) c[m] = () => c; c.maybeSingle = async () => ({ data: Array.isArray(tables[table]) ? (tables[table] as unknown[])[0] ?? null : tables[table] ?? null }); c.then = (ok: (v: unknown) => unknown) => ok({ data: tables[table] ?? [] }); return c; };
const ctx: Ctx = { supabase: { from: (t: string) => chain(t) } as never, tenantId: "t1", userId: "u1" };

const ID = "11111111-1111-4111-8111-111111111111";
const item = (o = {}) => ({ id: ID, item_code: "R-1", initiative_name: "Checkout", description: "Pay **fast**", moscow: "Must", g2m_date_est: null, planned_start: null, home_project_id: "p1", ...o });
const plink = { project_id: "p1", connection_id: "c1", site_id: "s1", jira_project_key: "PLAT", jira_project_name: "Platform", initiative_type_id: "10000" };
const conn = (state = "connected") => ({ id: "c1", state, sites: [{ id: "s1", name: "Acme", url: "https://acme.example.test" }] });
const synced = { title: hashText("Checkout"), description: hashText(adfToText(markdownToAdf("Pay **fast**"))) };
const link = (o = {}) => ({ item_id: ID, connection_id: "c1", site_id: "s1", issue_key: "PLAT-1", issue_id: "1", html_url: "https://acme.example.test/browse/PLAT-1", mode: "push", sync_base: synced, sent_hash: null, ...o });

type Hit = { method: string; path: string; body?: unknown };
/** A fake Jira: GET /issue/KEY returns `issue`, writes are recorded and answered with the given statuses. */
function fakeJira(issue: { summary: string; description?: unknown; labels?: string[] } | null, answers: { put?: number; post?: number; search?: unknown[] } = {}) {
  const hits: Hit[] = [];
  const call: JiraRequest = async (method, path, body) => {
    hits.push({ method, path, body });
    if (method === "GET" && path.startsWith("/issue/")) return issue ? { status: 200, json: { id: "1", fields: { summary: issue.summary, description: issue.description ?? markdownToAdf("Pay **fast**"), labels: issue.labels ?? ["product-velocity", "pv:moscow/must"] } } } : { status: 404, json: {} };
    if (method === "GET" && path.startsWith("/search/jql")) return { status: 200, json: { issues: answers.search ?? [] } };
    if (method === "PUT") return { status: answers.put ?? 204, json: {} };
    if (method === "POST") return { status: answers.post ?? 201, json: { key: "PLAT-7", id: "70" } };
    return { status: 500, json: {} };
  };
  return { call, hits };
}
const writes = (h: Hit[]) => h.filter((x) => x.method !== "GET");
const choice = (field: "title" | "description", c: "pv" | "github", ghHash: string) => ({ itemId: ID, field, choice: c, ghHash });

beforeEach(() => { rpcCalls.length = 0; rpcFail = null; tables = { items: item(), item_jira_links: link(), jira_project_links: [plink], jira_connections: conn() }; });
const loadIt = async () => (await import("./jira-sync-engine")).load(ctx, ID);

describe("preview (evaluate)", () => {
  it("writes nothing, ever: a preview makes only GET requests", async () => {
    const j = fakeJira({ summary: "Checkout (Jira)" });
    await evaluate((await loadIt())!, {}, j.call);
    expect(writes(j.hits)).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });
  it("a title changed only in Jira is a conflict whose default is Keep Product Velocity", async () => {
    const e = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Renamed in Jira" }).call);
    expect(e.kind).toBe("ok");
    if (e.kind !== "ok") return;
    expect(e.conflicts).toMatchObject([{ field: "title", kind: "github", pv: "Checkout", github: "Renamed in Jira", defaultChoice: "pv" }]);
    expect(previewParts(e).conflicts).toHaveLength(1);
  });
  it("a project link without a Jira link plans a create; a read-only link plans nothing; a missing issue and a lost sign-in are reported", async () => {
    tables.item_jira_links = null;
    const create = await evaluate((await loadIt())!, {}, fakeJira(null).call);
    expect(create).toMatchObject({ kind: "ok", plan: { action: "create" }, card: { repo: "PLAT" } });
    tables.item_jira_links = link({ mode: "follow" });
    expect((await evaluate((await loadIt())!, {}, fakeJira(null).call)).kind).toBe("follows");
    tables.item_jira_links = link();
    expect((await evaluate((await loadIt())!, {}, fakeJira(null).call)).kind).toBe("missing");
    tables.jira_connections = conn("reconnect_needed");
    expect(await evaluate((await loadIt())!, {}, fakeJira(null).call)).toMatchObject({ kind: "error", reconnect: true });
  });
});

describe("confirm (writeOne)", () => {
  it("sends only what Product Velocity changed, then records the base; description and status are not in the request", async () => {
    tables.items = item({ initiative_name: "Checkout v2" });
    const j = fakeJira({ summary: "Checkout" });
    const r = await writeOne(ctx, ID, [], { call: j.call });
    expect(r).toMatchObject({ result: { outcome: "updated", issueLabel: "PLAT-1" } });
    const [w] = writes(j.hits);
    expect(w).toMatchObject({ method: "PUT", path: "/issue/PLAT-1" });
    const f = (w!.body as { fields: Record<string, unknown> }).fields;
    expect(f.summary).toBe("Checkout v2");
    expect(f.description).toBeUndefined();
    expect(JSON.stringify(f)).not.toMatch(/status|transition/i);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["jira_record_sync"]);
    expect(rpcCalls[0]!.args.p_actor).toBe("u1");
  });
  it("Keep Jira takes the text into Product Velocity first, sends nothing for it, and gives the undo step the old value", async () => {
    const j = fakeJira({ summary: "Renamed in Jira" });
    const r = await writeOne(ctx, ID, [choice("title", "github", hashText("Renamed in Jira"))], { call: j.call });
    expect(r).toMatchObject({ result: { outcome: "updated" }, taken: [{ field: "initiative_name", before: "Old", after: "Renamed in Jira" }] });
    expect(Object.keys((writes(j.hits)[0]!.body as { fields: object }).fields)).not.toContain("summary"); // Jira's title is kept; only the extras (labels...) went out
    expect(rpcCalls.map((c) => c.fn)).toEqual(["jira_apply_pull", "jira_record_sync"]);
    expect(rpcCalls[0]!.args.p_fields).toEqual({ initiative_name: "Renamed in Jira" });
  });
  it("Keep Product Velocity overwrites Jira's title only after the choice", async () => {
    const j = fakeJira({ summary: "Renamed in Jira" });
    const r = await writeOne(ctx, ID, [choice("title", "pv", hashText("Renamed in Jira"))], { call: j.call });
    expect(r).toMatchObject({ result: { outcome: "updated" } });
    expect((writes(j.hits)[0]!.body as { fields: { summary: string } }).fields.summary).toBe("Checkout");
  });
  it("stops with nothing written when Jira changed after the preview, or a conflict has no choice", async () => {
    const noChoice = fakeJira({ summary: "Renamed in Jira" });
    expect(await writeOne(ctx, ID, [], { call: noChoice.call })).toMatchObject({ stale: true });
    const changedAgain = fakeJira({ summary: "Renamed twice" });
    expect(await writeOne(ctx, ID, [choice("title", "pv", hashText("Renamed in Jira"))], { call: changedAgain.call })).toMatchObject({ stale: true });
    expect(writes(noChoice.hits)).toEqual([]);
    expect(writes(changedAgain.hits)).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });
  it("creates the initiative's issue, finds an earlier one by its marker instead of creating twice, and links it", async () => {
    tables.item_jira_links = null;
    const j = fakeJira(null);
    const r = await writeOne(ctx, ID, [], { call: j.call });
    expect(r).toMatchObject({ result: { outcome: "created", issueLabel: "PLAT-7", issueUrl: "https://acme.example.test/browse/PLAT-7" } });
    expect(writes(j.hits)).toHaveLength(1);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["jira_create_link"]);
    expect(rpcCalls[0]!.args).toMatchObject({ p_key: "PLAT-7", p_connection: "c1", p_site: "s1" });
    rpcCalls.length = 0;
    const again = fakeJira(null, { search: [{ key: "PLAT-5", id: "50" }] });
    const r2 = await writeOne(ctx, ID, [], { call: again.call });
    expect(r2).toMatchObject({ result: { outcome: "created", issueLabel: "PLAT-5" } });
    expect(writes(again.hits)).toEqual([]);
  });
  it("a refusal and a missing issue are per-initiative results and the base is not recorded", async () => {
    tables.items = item({ initiative_name: "Checkout v2" });
    for (const [status, outcome] of [[400, "error"], [404, "missing"]] as const) {
      rpcCalls.length = 0;
      const j = fakeJira({ summary: "Checkout" }, { put: status });
      const r = await writeOne(ctx, ID, [], { call: j.call });
      expect(r).toMatchObject({ result: { outcome } });
      expect(rpcCalls).toEqual([]);
    }
  }, 30000);
  it("a lost sign-in during the send is reported and never retried", async () => {
    tables.items = item({ initiative_name: "Checkout v2" });
    const { ReconnectNeeded } = await import("./token-provider");
    let puts = 0;
    const call: JiraRequest = async (m) => { if (m === "GET") return { status: 200, json: { id: "1", fields: { summary: "Checkout", description: markdownToAdf("Pay **fast**"), labels: ["product-velocity", "pv:moscow/must"] } } }; puts++; throw new ReconnectNeeded(); };
    const r = await writeOne(ctx, ID, [], { call });
    expect(r).toMatchObject({ result: { outcome: "error", message: expect.stringMatching(/sign in again/i) } });
    expect(puts).toBe(1);
  });
  it("a read-only link is never written", async () => {
    tables.item_jira_links = link({ mode: "follow" });
    const j = fakeJira({ summary: "x" });
    expect(await writeOne(ctx, ID, [], { call: j.call })).toMatchObject({ result: { outcome: "blocked" } });
    expect(writes(j.hits)).toEqual([]);
  });
  it("when saving the new base fails the result says so, so the next sync finishes it", async () => {
    tables.items = item({ initiative_name: "Checkout v2" });
    rpcFail = "jira_record_sync";
    expect(await writeOne(ctx, ID, [], { call: fakeJira({ summary: "Checkout" }).call })).toMatchObject({ result: { outcome: "error", message: expect.stringMatching(/Sync again/) } });
  });
});
