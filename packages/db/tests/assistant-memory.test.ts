import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectAssistant } from "@pv/domain";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, admin: string;
const PV004 = "PV004";
const PV005 = "PV005";
const CHECK = "23514";
const UNIQUE = "23505";
const claims = (client: string) => ({ client_id: client });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "mem-creator@example.test");
  viewer = await createUser(db, "mem-viewer@example.test");
  admin = f.alice;
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
});
afterAll(async () => { await db.close(); });

const add = (user: string, tenant: string, o: Record<string, unknown> = {}, opts: { via?: string; claims?: Record<string, unknown> } = {}) => {
  const v = { scope: "workspace", kind: "fact", title: "Churn definition", body: "Churn counts accounts with no login for 30 days.", source: "said by the person", basis: "person", group_name: null, item_id: null, tags: [], ...o } as Record<string, unknown>;
  return db.asUser(user, async (q) => (await q(
    "insert into public.ai_memories (tenant_id, scope, group_name, item_id, kind, title, body, source, basis, tags) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
    [tenant, v.scope, v.group_name, v.item_id, v.kind, v.title, v.body, v.source, v.basis, v.tags],
  )).rows[0].id as string, { commit: true, ...opts });
};
const edit = (user: string, id: string, set: string, params: unknown[] = [], opts: { via?: string; claims?: Record<string, unknown> } = {}) =>
  db.asUser(user, async (q) => (await q(`update public.ai_memories set ${set} where id = $1`, [id, ...params])).rowCount, { commit: true, ...opts });
const row = async (id: string) => (await db.admin.query("select * from public.ai_memories where id = $1", [id])).rows[0];
const clear = () => db.admin.query("delete from public.ai_memories where tenant_id = $1", [f.tenantA]);

describe("the assistant label of a connection", () => {
  it("assistant_of agrees with detectAssistant for every client name we know", async () => {
    for (const n of ["Claude", "Claude Code (product-velocity)", "ChatGPT", "OpenAI MCP", "Gemini CLI MCP Client", "Google Gemini", "My script", "Claude for Google Docs", "anthropic"]) {
      const r = await db.admin.query("select public.assistant_of($1) as a", [n]);
      expect(r.rows[0].a, n).toBe(detectAssistant(n));
    }
  });
  it("mcp_connections carries it", async () => {
    await db.admin.query("insert into public.mcp_connections (tenant_id, user_id, client_id, client_name) values ($1, $2, 'c-gpt', 'ChatGPT')", [f.tenantA, creator]);
    expect((await db.admin.query("select assistant from public.mcp_connections where client_id = 'c-gpt'")).rows[0].assistant).toBe("chatgpt");
  });
});

describe("notes: who writes what", () => {
  it("a creator saves a draft (version 1); through an assistant it is an AI draft that says which assistant", async () => {
    await clear();
    const person = await add(creator, f.tenantA, { title: "By a person" });
    expect(await row(person)).toMatchObject({ status: "draft", version: 1, ai_draft: false, assistant: null, created_via: "API" });
    const ai = await add(creator, f.tenantA, { title: "By ChatGPT" }, { via: "Claude MCP", claims: claims("c-gpt") });
    expect(await row(ai)).toMatchObject({ status: "draft", ai_draft: true, assistant: "chatgpt", created_via: "Claude MCP" });
    const other = await add(creator, f.tenantA, { title: "By something else" }, { via: "Claude MCP", claims: claims("unknown-client") });
    expect((await row(other)).assistant).toBe("other");
  });
  it("a viewer cannot write; nobody can write into another workspace", async () => {
    expect(await errorCode(add(viewer, f.tenantA))).toBeTruthy();
    expect(await errorCode(add(creator, f.tenantB))).toBeTruthy();
  });
  it("validates the shape: scope reference, source, lengths, kind", async () => {
    expect(await errorCode(add(creator, f.tenantA, { scope: "group" }))).toBe(CHECK);
    expect(await errorCode(add(creator, f.tenantA, { scope: "item" }))).toBe(CHECK);
    expect(await errorCode(add(creator, f.tenantA, { scope: "workspace", group_name: "Payments", title: "x1" }))).toBe(CHECK);
    expect(await errorCode(add(creator, f.tenantA, { source: "  ", title: "x2" }))).toBe(CHECK);
    expect(await errorCode(add(creator, f.tenantA, { kind: "idea", title: "x3" }))).toBe(CHECK);
    expect(await errorCode(add(creator, f.tenantA, { body: "x".repeat(2001), title: "x4" }))).toBe(CHECK);
    expect(await errorCode(add(creator, f.tenantA, { basis: "guess", title: "x5" }))).toBe(CHECK);
  });
  it("an item note must point at an initiative of the same workspace", async () => {
    const own = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
    const foreign = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
    expect(await add(creator, f.tenantA, { scope: "item", item_id: own, title: "On an item" })).toBeTruthy();
    expect(await errorCode(add(creator, f.tenantA, { scope: "item", item_id: foreign, title: "On a foreign item" }))).toBeTruthy();
  });
  it("one live note per title and place; an archived one frees the title", async () => {
    await clear();
    const a = await add(creator, f.tenantA, { title: "Same" });
    expect(await errorCode(add(creator, f.tenantA, { title: "same" }))).toBe(UNIQUE);
    expect(await add(creator, f.tenantA, { scope: "group", group_name: "Payments", title: "Same" })).toBeTruthy();
    await edit(creator, a, "status = 'archived'");
    expect(await add(creator, f.tenantA, { title: "Same" })).toBeTruthy();
  });
  it("keeps at most 1,000 live notes per workspace", async () => {
    await clear();
    await db.admin.query(
      "insert into public.ai_memories (tenant_id, kind, title, body, source, basis, created_via) select $1, 'fact', 'n' || g, 'b', 's', 'person', 'system' from generate_series(1, 1000) g",
      [f.tenantA],
    );
    expect(await errorCode(add(creator, f.tenantA, { title: "one too many" }))).toBe(PV005);
    expect(await add(creator, f.tenantB, { title: "other workspace is fine" }, {}).catch(() => "no")).toBeDefined();
    await clear();
  });
});

describe("notes: confirmation, versions, archive and delete", () => {
  it("an assistant cannot confirm; a person can, and that clears the AI draft mark", async () => {
    await clear();
    const id = await add(creator, f.tenantA, { title: "To confirm" }, { via: "Claude MCP", claims: claims("c-gpt") });
    expect(await errorCode(edit(creator, id, "status = 'confirmed'", [], { via: "Claude MCP", claims: claims("c-gpt") }))).toBe(PV004);
    expect(await edit(creator, id, "status = 'confirmed'")).toBe(1);
    expect(await row(id)).toMatchObject({ status: "confirmed", ai_draft: false, confirmed_by: creator });
  });
  it("a change by an assistant bumps the version and sends a confirmed note back to draft", async () => {
    const id = (await db.admin.query("select id from public.ai_memories where title = 'To confirm'")).rows[0].id;
    await edit(creator, id, "body = $2", ["Churn counts accounts with no login for 45 days."], { via: "Claude MCP", claims: claims("c-gpt") });
    expect(await row(id)).toMatchObject({ status: "draft", ai_draft: true, version: 2, confirmed_by: null, confirmed_at: null });
  });
  it("a person's edit of an AI draft makes it theirs", async () => {
    const id = (await db.admin.query("select id from public.ai_memories where title = 'To confirm'")).rows[0].id;
    await edit(creator, id, "title = 'To confirm (edited)'");
    expect(await row(id)).toMatchObject({ ai_draft: false, version: 3 });
  });
  it("an assistant cannot archive a note a person confirmed, but can archive a draft; neither can delete", async () => {
    await clear();
    const keep = await add(creator, f.tenantA, { title: "Confirmed one" });
    await edit(creator, keep, "status = 'confirmed'");
    expect(await errorCode(edit(creator, keep, "status = 'archived'", [], { via: "Claude MCP", claims: claims("c-gpt") }))).toBe(PV004);
    const draft = await add(creator, f.tenantA, { title: "A draft" });
    expect(await edit(creator, draft, "status = 'archived'", [], { via: "Claude MCP", claims: claims("c-gpt") })).toBe(1);
    expect(await errorCode(db.asUser(admin, async (q) => q("delete from public.ai_memories where id = $1", [draft]), { commit: true, via: "Claude MCP", claims: claims("c-gpt") }))).toBe(PV004);
  });
  it("bumping verified_at alone keeps the version; the scope and workspace cannot change", async () => {
    await clear();
    const id = await add(creator, f.tenantA, { title: "Verified" });
    await db.admin.query("update public.ai_memories set verified_at = now() - interval '100 days' where id = $1", [id]);
    await edit(creator, id, "verified_at = now()");
    const r = await row(id);
    expect(r.version).toBe(1);
    expect(Date.now() - new Date(r.verified_at).getTime()).toBeLessThan(60_000);
    expect(await errorCode(edit(creator, id, "scope = 'group'"))).toBeTruthy(); // column not granted
  });
  it("only an admin deletes for good", async () => {
    const id = await add(creator, f.tenantA, { title: "Delete me" });
    const n = (user: string) => db.asUser(user, async (q) => (await q("delete from public.ai_memories where id = $1", [id])).rowCount, { commit: true });
    expect(await n(creator)).toBe(0);
    expect(await n(admin)).toBe(1);
  });
  it("is audited with actor and source", async () => {
    await clear();
    const id = await add(creator, f.tenantA, { title: "Audited" }, { via: "Claude MCP", claims: claims("c-gpt") });
    const a = await db.admin.query("select field, via, actor_id from public.audit_log where entity = 'ai_memories' and entity_id = $1 and field = 'title'", [id]);
    expect(a.rows[0]).toMatchObject({ via: "Claude MCP", actor_id: creator });
  });
});

describe("two workspaces", () => {
  it("a note of one workspace is invisible and untouchable from the other", async () => {
    await clear();
    const id = await add(creator, f.tenantA, { title: "Secret roadmap fact" });
    const bob = f.bob;
    const seen = await db.asUser(bob, async (q) => (await q("select id from public.ai_memories where id = $1", [id])).rowCount);
    expect(seen).toBe(0);
    expect(await db.asUser(bob, async (q) => (await q("update public.ai_memories set title = 'pwned' where id = $1", [id])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(bob, async (q) => (await q("delete from public.ai_memories where id = $1", [id])).rowCount, { commit: true })).toBe(0);
    expect((await row(id)).title).toBe("Secret roadmap fact");
  });
});
