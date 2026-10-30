import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectAssistant } from "@pv/domain";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Request #230: the AI tool and model on documents, their history per version, and the document-submission log for admins.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, pat: string;
let item: string;
const GPT = "client-gpt", GEM = "client-gem";
const claims = (client: string) => ({ client_id: client });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "doc-creator@example.test");
  pat = await createUser(db, "pat@platform.test");
  await db.admin.query("insert into platform.admins (user_id) values ($1)", [pat]);
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await db.admin.query(`update auth.users set raw_user_meta_data = '{"full_name":"Cora Creator"}' where id = $1`, [creator]);
  await db.admin.query("insert into public.mcp_connections (tenant_id, user_id, client_id, client_name) values ($1, $2, $3, 'ChatGPT'), ($1, $2, $4, 'Gemini CLI MCP Client')", [f.tenantA, creator, GPT, GEM]);
  item = (await db.admin.query("select id from public.items where tenant_id = $1 order by item_code limit 1", [f.tenantA])).rows[0].id;
});
afterAll(async () => { await db.close(); });

const asAi = (client: string, sql: string, params: unknown[]) => db.asUser(creator, async (q) => (await q(sql, params)).rows, { commit: true, via: "Claude MCP", claims: claims(client) });
const doc = async (id: string) => (await db.admin.query("select * from public.item_documents where id = $1", [id])).rows[0];
const versions = async (id: string) => (await db.admin.query("select version, ai_tool, ai_model, saved_via, saved_by_name, saved_by_email from public.item_document_versions where document_id = $1 order by version", [id])).rows;

describe("the assistant label", () => {
  it("assistant_of agrees with detectAssistant, and a connection carries it", async () => {
    for (const n of ["Claude", "Claude Code (x)", "ChatGPT", "OpenAI MCP", "Gemini CLI MCP Client", "My script", "Claude for Google Docs"]) {
      expect((await db.admin.query("select public.assistant_of($1) as a", [n])).rows[0].a, n).toBe(detectAssistant(n));
    }
    expect((await db.admin.query("select assistant from public.mcp_connections where client_id = $1", [GPT])).rows[0].assistant).toBe("chatgpt");
  });
});

describe("AI tool and model on a document and on each version", () => {
  let id: string;
  it("a document written through ChatGPT records the tool from the connection and the model it states", async () => {
    id = (await asAi(GPT, "insert into public.item_documents (tenant_id, item_id, kind, title, body, ai_model) values ($1, $2, 'prd', 'PRD', '# v1', $3) returning id", [f.tenantA, item, "GPT-5"]))[0].id;
    expect(await doc(id)).toMatchObject({ ai_tool: "chatgpt", ai_model: "GPT-5", ai_draft: true });
    expect((await versions(id))[0]).toMatchObject({ version: 1, ai_tool: "chatgpt", ai_model: "GPT-5", saved_by_name: "Cora Creator", saved_by_email: "doc-creator@example.test" });
  });
  it("a review by Gemini takes over the document's tool and model and keeps the history of the first version", async () => {
    await asAi(GEM, "update public.item_documents set body = '# v2 reviewed', ai_model = $2 where id = $1", [id, "Gemini 3 Pro"]);
    expect(await doc(id)).toMatchObject({ ai_tool: "gemini", ai_model: "Gemini 3 Pro", version: 2 });
    const v = await versions(id);
    expect(v.map((x) => [x.version, x.ai_tool, x.ai_model])).toEqual([[1, "chatgpt", "GPT-5"], [2, "gemini", "Gemini 3 Pro"]]);
  });
  it("an assistant that does not state its model does not inherit the previous one", async () => {
    await asAi(GPT, "update public.item_documents set body = '# v3', ai_model = null where id = $1", [id]);
    expect(await doc(id)).toMatchObject({ ai_tool: "chatgpt", ai_model: null });
    expect((await versions(id))[2]).toMatchObject({ ai_tool: "chatgpt", ai_model: null });
  });
  it("a status change by an assistant, or any edit by a person, leaves the AI columns alone; a person's version has none", async () => {
    await asAi(GEM, "update public.item_documents set status = 'in_review' where id = $1", [id]);
    expect(await doc(id)).toMatchObject({ ai_tool: "chatgpt", ai_model: null });
    await db.asUser(creator, (q) => q("update public.item_documents set body = '# v4 by a person', ai_model = 'Hacked' where id = $1", [id]), { commit: true, via: "UI" });
    expect(await doc(id)).toMatchObject({ ai_tool: "chatgpt", ai_model: null, version: 4 });
    expect((await versions(id))[3]).toMatchObject({ version: 4, ai_tool: null, ai_model: null, saved_via: "UI" });
  });
  it("a person cannot set the tool or the model on a new document, and the model is limited to 80 characters", async () => {
    const r = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, title, ai_model) values ($1, $2, 'By a person', 'Claude Opus') returning id", [f.tenantA, item])).rows[0].id, { commit: true });
    expect(await doc(r)).toMatchObject({ ai_tool: null, ai_model: null });
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_documents set ai_tool = 'claude' where id = $1", [r]), { commit: true }))).toBeTruthy(); // no grant
    expect(await errorCode(asAi(GPT, "insert into public.item_documents (tenant_id, item_id, title, ai_model) values ($1, $2, 'Long', $3)", [f.tenantA, item, "x".repeat(81)]))).toBe("23514");
  });
});

describe("the document-submission log", () => {
  it("an account admin sees every saved version with person, project, initiative, type, date, tool and model, and no text", async () => {
    const rows = await db.asUser(f.alice, async (q) => (await q("select * from public.document_submissions($1)", [f.tenantA])).rows);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const first = rows.find((r) => r.version === 1 && r.ai_tool === "chatgpt")!;
    expect(first).toMatchObject({ person_name: "Cora Creator", person_email: "doc-creator@example.test", kind: "prd", title: "PRD", ai_model: "GPT-5", tenant_name: expect.any(String), project_name: "Platform" });
    expect(first.item_code).toMatch(/^R-/);
    expect(first.initiative_name).toBeTruthy();
    expect(first.saved_at).toBeTruthy();
    expect(Object.keys(first)).not.toContain("body");
  });
  it("a creator, a member of another account and an outsider get nothing", async () => {
    expect(await db.asUser(creator, async (q) => (await q("select * from public.document_submissions($1)", [f.tenantA])).rows)).toEqual([]);
    expect(await db.asUser(f.bob, async (q) => (await q("select * from public.document_submissions($1)", [f.tenantA])).rows)).toEqual([]);
    expect(await db.asUser(f.alice, async (q) => (await q("select * from public.document_submissions($1)", [f.tenantB])).rows)).toEqual([]);
  });
  it("paging goes back in time", async () => {
    const all = await db.asUser(f.alice, async (q) => (await q("select saved_at from public.document_submissions($1, 2)", [f.tenantA])).rows);
    expect(all).toHaveLength(2);
    const older = await db.asUser(f.alice, async (q) => (await q("select saved_at from public.document_submissions($1, 50, $2)", [f.tenantA, all[1].saved_at])).rows);
    for (const r of older) expect(new Date(r.saved_at).getTime()).toBeLessThan(new Date(all[1].saved_at).getTime());
  });
  it("only a platform admin may read across accounts; nobody else, an account admin included", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.platform_document_submissions()")))).toBe("42501");
    const all = await db.asUser(pat, async (q) => (await q("select * from public.platform_document_submissions()")).rows);
    expect(new Set(all.map((r) => r.tenant_id))).toEqual(new Set([f.tenantA, f.tenantB]));
    expect(all[0].tenant_name).toBeTruthy();
    const one = await db.asUser(pat, async (q) => (await q("select * from public.platform_document_submissions($1)", [f.tenantB])).rows);
    expect(one.length).toBeGreaterThan(0);
    expect(new Set(one.map((r) => r.tenant_id))).toEqual(new Set([f.tenantB]));
  });
});
