import { beforeEach, describe, expect, it, vi } from "vitest";
import { markdownToAdf } from "./adf";
import type { JiraRequest } from "./jira-write";

vi.mock("server-only", () => ({}));
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcFail: string | null = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return fn === rpcFail ? { data: null, error: { message: "x" } } : { data: fn === "jira_apply_pull" ? { initiative_name: "Old", description: null } : null, error: null }; } }) }));
vi.mock("./server", () => ({ jiraRequest: () => { throw new Error("the real Jira must not be reached in tests"); } }));

import { COLS, evaluate, previewParts, writeOne, type Ctx } from "./jira-sync-engine";
import { hashText } from "@pv/github";
import { adfToText } from "./adf";

// A fake database: each table answers with its fixture whatever the filters are (the real filtering is row-level security).
let tables: Record<string, unknown>;
const chain = (table: string) => { const eqs: [string, unknown][] = []; const c: Record<string, unknown> = {}; for (const m of ["select", "is", "in", "order"]) c[m] = () => c; c.eq = (k: string, v: unknown) => { eqs.push([k, v]); return c; }; c.maybeSingle = async () => ({ data: Array.isArray(tables[table]) ? (tables[table] as unknown[])[0] ?? null : tables[table] ?? null }); c.then = (ok: (v: unknown) => unknown) => ok({ data: Array.isArray(tables[table]) ? (tables[table] as Record<string, unknown>[]).filter((x) => eqs.every(([k, v]) => !(k in x) || x[k] === v)) : tables[table] ?? [] }); return c; };
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

describe("the columns it reads", () => {
  // The same list is checked against the real table in packages/db/tests/jira-sync-write.test.ts: a column that does not exist makes the whole read fail.
  it("are real columns of items (G2M Date (est) is end_date), never dictionary keys that have no column", () => {
    expect(COLS.split(", ").sort()).toEqual(["change_type", "description", "end_date", "focus_area", "g2m_quarter", "home_project_id", "hypothesis", "id", "initiative_name", "initiative_phase", "item_code", "moscow", "planned_start", "stack_rank", "summary", "theme", "value_type"]);
  });
  it("a row read that way still gives the engine G2M Date (est) under its field key", async () => {
    tables.items = { id: ID, item_code: "R-1", initiative_name: "Checkout", description: null, moscow: "Must", end_date: "2027-03-31", planned_start: null, home_project_id: "p1" };
    const e = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout" }).call);
    expect(e.kind === "ok" && e.plan.fields.duedate).toBe("2027-03-31");
  });
});

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

describe("the field mapping of the project", () => {
  it("start date and priority are sent when mapped, and skipped with a note when not", async () => {
    tables.items = item({ planned_start: "2027-01-04" });
    const without = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout" }).call);
    expect(without.kind === "ok" && without.plan.fields.customfield_10015).toBeFalsy();
    expect(without.kind === "ok" && without.plan.notes.join(" ")).toMatch(/Start date not sent/);
    tables.jira_project_links = [{ ...plink, field_map: { startDate: "customfield_10015", priorityByMoscow: { Must: "1" } } }];
    const mapped = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout" }).call);
    expect(mapped.kind === "ok" && mapped.plan.fields).toMatchObject({ customfield_10015: "2027-01-04", priority: { id: "1" } });
    // a malformed stored value never reaches Jira
    tables.jira_project_links = [{ ...plink, field_map: { startDate: "duedate", priorityByMoscow: { Must: "High" } } }];
    const bad = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout" }).call);
    expect(bad.kind === "ok" && JSON.stringify(bad.plan.fields)).not.toMatch(/duedate"?:"?2027|High/);
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

describe("the saved field configuration (decision 2026-11-03-tracker-field-config)", () => {
  const withFields = (j: ReturnType<typeof fakeJira>, ids: string[]): JiraRequest => async (m, p, b) => (m === "GET" && p === "/field" ? { status: 200, json: ids.map((id) => ({ id, name: id, custom: true })) } : j.call(m, p, b));
  const dated = () => { tables.items = { id: ID, item_code: "R-1", initiative_name: "Checkout", description: "Pay **fast**", moscow: "Must", end_date: "2027-03-31", planned_start: "2027-01-04", home_project_id: "p1" }; };

  it("without any saved configuration the plan is the one from before it existed", async () => {
    dated();
    const e = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout", labels: [] }).call);
    expect(e.kind === "ok" && e.plan.fields.duedate).toBe("2027-03-31");
    expect(e.kind === "ok" && (e.plan.fields.labels as string[])).toContain("pv:moscow/must");
  });
  it("a re-pointed due date field and a switched-off label are used by the preview", async () => {
    dated();
    tables.tracker_field_config = [{ slot: "jira.dueDate", enabled: true, field_id: "customfield_10016" }, { slot: "jira.label.moscow", enabled: false, field_id: null }];
    const j = fakeJira({ summary: "Checkout", labels: [] });
    const e = await evaluate((await loadIt())!, {}, withFields(j, ["customfield_10016"]));
    expect(e.kind).toBe("ok");
    if (e.kind !== "ok") return;
    expect(e.plan.fields.customfield_10016).toBe("2027-03-31");
    expect("duedate" in e.plan.fields).toBe(false);
    expect(e.plan.fields.labels as string[]).not.toContain("pv:moscow/must");
    expect(e.plan.notes.join(" ")).toContain("MoSCoW label not sent: switched off in the field configuration.");
  });
  it("a configured field that is gone from the site is left out and the preview says so", async () => {
    dated();
    tables.tracker_field_config = [{ slot: "jira.dueDate", enabled: true, field_id: "customfield_10099" }];
    const e = await evaluate((await loadIt())!, {}, withFields(fakeJira({ summary: "Checkout", labels: [] }), ["customfield_10016"]));
    expect(e.kind).toBe("ok");
    if (e.kind !== "ok") return;
    expect("customfield_10099" in e.plan.fields || "duedate" in e.plan.fields).toBe(false);
    expect(e.plan.notes.join(" ")).toContain("Due date not sent: the Jira field customfield_10099 no longer exists on this site.");
  });
  it("a stored row for a commercial field or a fixed slot is ignored", async () => {
    dated();
    tables.tracker_field_config = [{ slot: "value_12m", enabled: false, field_id: null }, { slot: "jira.summary", enabled: false, field_id: null }, { slot: "jira.description", enabled: false, field_id: null }];
    const e = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout", labels: [] }).call);
    expect(e.kind === "ok" && e.plan.notes.join(" ")).not.toContain("switched off");
  });
});

describe("the description sections of an initiative (issue #319)", () => {
  const withApp: Ctx = { ...ctx, appUrl: "https://app.example" };
  const TOKEN = "T".repeat(43);
  const rows = () => {
    tables.items = { id: ID, item_code: "R-1", initiative_name: "Checkout", summary: "Short", description: "Pay **fast**", hypothesis: "IF a THEN b", moscow: "Must", end_date: null, planned_start: null, home_project_id: "p1" };
    tables.item_attachments = [{ kind: "link", shared: true, name: "PRD", url: "https://example.test/prd" }, { kind: "link", shared: false, name: "Private", url: "https://example.test/private" }, { kind: "file", name: "Shot.png", share_token: TOKEN }, { kind: "file", name: "Secret.png", share_token: null }];
  };
  it("reads the summary, hypothesis, links and shared files, and sends them as sections; a file without a share link is named in the preview, not sent", async () => {
    rows();
    tables.item_jira_links = null;
    const l = (await (await import("./jira-sync-engine")).load(withApp, ID))!;
    const e = await evaluate(l, {}, fakeJira(null).call);
    expect(e.kind).toBe("ok");
    if (e.kind !== "ok") return;
    const t = adfToText(e.plan.fields.description).replace(/\n+/g, "|");
    expect(t).toBe(`Summary|Short|Description|Pay fast|Hypothesis (IF / THEN / RESULTING IN)|IF a THEN b|Artifacts|- PRD|Files|- Shot.png`);
    expect(JSON.stringify(e.plan.fields.description)).toContain(`https://app.example/f/${TOKEN}/Shot.png`);
    expect(JSON.stringify(e.plan.fields.description)).not.toContain("Secret.png");
    expect(JSON.stringify(e.plan.fields.description)).not.toContain("example.test/private"); // a link set to "do not share" stays in Product Velocity
    expect(e.plan.notes.join(" ")).toContain("1 attached file has no share link");
  });
  it("without an app address no file is linked (and nothing is said about it)", async () => {
    rows();
    tables.item_jira_links = null;
    const l = (await (await import("./jira-sync-engine")).load(ctx, ID))!;
    const e = await evaluate(l, {}, fakeJira(null).call);
    expect(e.kind === "ok" && JSON.stringify(e.plan.fields.description)).not.toContain("Shot.png");
  });
  it("switching the Files section off in the field configuration leaves it out and says so", async () => {
    rows();
    tables.item_jira_links = null;
    tables.tracker_field_config = [{ slot: "jira.body.files", enabled: false, field_id: null }];
    const l = (await (await import("./jira-sync-engine")).load(withApp, ID))!;
    const e = await evaluate(l, {}, fakeJira(null).call);
    expect(e.kind).toBe("ok");
    if (e.kind !== "ok") return;
    expect(adfToText(e.plan.fields.description)).not.toContain("Shot.png");
    expect(e.plan.notes.join(" ")).toContain("File links not sent: switched off");
  });
  it("Keep Jira on the hypothesis takes the text into Product Velocity and records its hash", async () => {
    rows();
    const edited = markdownToAdf("## Summary\n\nShort\n\n## Description\n\nPay **fast**\n\n## Hypothesis (IF / THEN / RESULTING IN)\n\nIF changed in Jira");
    const base = { title: hashText("Checkout"), summary: hashText("Short"), description: hashText(adfToText(markdownToAdf("Pay **fast**"))), hypothesis: hashText("IF a THEN b") };
    tables.item_jira_links = link({ sync_base: base });
    const j = fakeJira({ summary: "Checkout", description: edited, labels: ["product-velocity", "pv:moscow/must"] });
    const e = await evaluate((await (await import("./jira-sync-engine")).load(withApp, ID))!, {}, j.call);
    expect(e.kind === "ok" && e.conflicts).toMatchObject([{ field: "hypothesis", kind: "github", pv: "IF a THEN b", github: "IF changed in Jira" }]);
    const w = await writeOne(withApp, ID, [choice("hypothesis" as never, "github", hashText("IF changed in Jira"))], { call: j.call });
    expect("result" in w && w.result.outcome).not.toBe("error");
    const pull = rpcCalls.find((c) => c.fn === "jira_apply_pull")!;
    expect(pull.args.p_fields).toEqual({ hypothesis: "IF changed in Jira" });
    expect((pull.args.p_base as Record<string, string>).hypothesis).toBe(hashText("IF changed in Jira"));
  });
});

describe("the optional labels in the engine (issue #321)", () => {
  const rows = () => {
    tables.items = { id: ID, item_code: "R-1", initiative_name: "Checkout", description: "Pay **fast**", moscow: "Must", focus_area: "Publishers", value_type: "Defend revenue", end_date: null, g2m_quarter: "Q3 2027", planned_start: null, home_project_id: "p1" };
    tables.item_tags = [{ value: "payments" }, { value: "Q4 push" }];
  };
  it("tags and focus area are not sent until the project switches them on (Business Value Type and Planned Quarter are on)", async () => {
    rows();
    const e = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout", labels: [] }).call);
    expect(e.kind === "ok" && (e.plan.fields.labels as string[]).some((l) => /pv:(tag|focus)\//.test(l))).toBe(false);
  });
  it("the Planned Quarter label is on by default and goes when its switch is off", async () => {
    rows();
    const on = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout", labels: [] }).call);
    expect(on.kind === "ok" && (on.plan.fields.labels as string[])).toContain("pv:quarter/q3-2027");
    tables.tracker_field_config = [{ slot: "jira.label.quarter", enabled: false, field_id: null }];
    const off = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout", labels: [] }).call);
    expect(off.kind === "ok" && (off.plan.fields.labels as string[]).some((l) => l.startsWith("pv:quarter/"))).toBe(false);
  });
  it("switched on, the tags, the focus area and the business value type are read and sent as pv: labels", async () => {
    rows();
    tables.tracker_field_config = ["tags", "focus", "value"].map((k) => ({ slot: `jira.label.${k}`, enabled: true, field_id: null }));
    const e = await evaluate((await loadIt())!, {}, fakeJira({ summary: "Checkout", labels: [] }).call);
    expect(e.kind === "ok" && (e.plan.fields.labels as string[])).toEqual(expect.arrayContaining(["pv:focus/publishers", "pv:value/defend-revenue", "pv:tag/payments", "pv:tag/q4-push"]));
  });
});
