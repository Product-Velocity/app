import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, approver: string;
const PV004 = "PV004";
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "wsdocs-creator@example.test");
  viewer = await createUser(db, "wsdocs-viewer@example.test");
  approver = await createUser(db, "wsdocs-approver@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, approver, "creator");
  await db.admin.query("update public.tenant_members set is_approver = true where tenant_id = $1 and user_id = $2", [f.tenantA, approver]);
});
afterAll(async () => { await db.close(); });

const add = (user: string, title = "Strategy", body = "# S", kind = "strategy", via = "UI") =>
  db.asUser(user, async (q) => (await q("insert into public.workspace_documents (tenant_id, kind, title, body) values ($1, $2, $3, $4) returning id", [f.tenantA, kind, title, body])).rows[0].id as string, { commit: true, via });
const edit = (user: string, id: string, set: string, params: unknown[] = [], via = "UI") =>
  db.asUser(user, async (q) => (await q(`update public.workspace_documents set ${set} where id = $1`, [id, ...params])).rowCount, { commit: true, via });
const row = async (id: string) => (await db.admin.query("select * from public.workspace_documents where id = $1", [id])).rows[0];

describe("workspace documents", () => {
  it("a creator adds one; version 1 is saved and the write is audited without the text", async () => {
    const id = await add(creator, "Vision 2027", "# Secret plan");
    expect(await row(id)).toMatchObject({ version: 1, status: "draft", ai_draft: false, created_via: "UI", kind: "strategy" });
    expect((await db.admin.query("select version, body from public.workspace_document_versions where document_id = $1", [id])).rows).toEqual([{ version: 1, body: "# Secret plan" }]);
    const a = (await db.admin.query("select field, new from public.audit_log where entity = 'workspace_documents' and entity_id = $1 and field = 'body'", [id])).rows;
    expect(JSON.stringify(a)).not.toContain("Secret");
  });
  it("editing the text bumps the version and keeps the old one", async () => {
    const id = await add(creator, "T", "one");
    await edit(creator, id, "body = $2", ["two"]);
    expect((await db.admin.query("select version, body from public.workspace_document_versions where document_id = $1 order by version", [id])).rows).toEqual([{ version: 1, body: "one" }, { version: 2, body: "two" }]);
  });
  it("a viewer reads but cannot write; another workspace sees nothing", async () => {
    const id = await add(creator, "Seen");
    expect(await db.asUser(viewer, async (q) => (await q("select id from public.workspace_documents where id = $1", [id])).rowCount)).toBe(1);
    expect(await errorCode(db.asUser(viewer, (q) => q("insert into public.workspace_documents (tenant_id, title) values ($1, 'x')", [f.tenantA]), { via: "UI" }))).not.toBe(null);
    expect(await db.asUser(f.bob, async (q) => (await q("select id from public.workspace_documents where id = $1", [id])).rowCount)).toBe(0);
  });
  it("refuses an unknown kind, an empty title and a text over the limit", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.workspace_documents (tenant_id, kind, title) values ($1, 'memo', 'x')", [f.tenantA]), { via: "UI" }))).toBe(CHECK);
    expect(await errorCode(add(creator, "  "))).toBe(CHECK);
    expect(await errorCode(add(creator, "Big", "x".repeat(200001)))).toBe(CHECK);
    for (const kind of ["vision", "strategy", "north_star", "competitive", "personas", "weekly_update", "release_notes", "quarter_plan", "impact_map", "market_sizing", "canvas", "other"]) {
      expect((await row(await add(creator, "K", "", kind))).kind).toBe(kind);
    }
  });
});

describe("Claude and approval", () => {
  it("a document written with a Claude token is an AI draft with the tool recorded, whatever the client sends, and Claude cannot flip it", async () => {
    const id = await add(creator, "From Claude", "x", "strategy", "MCP");
    expect(await row(id)).toMatchObject({ ai_draft: true, created_via: "MCP" });
    expect(await errorCode(edit(creator, id, "ai_draft = false", [], "MCP"))).toBe(PV004);
    await edit(creator, id, "ai_draft = false"); // a person accepts it
    expect((await row(id)).ai_draft).toBe(false);
  });
  it("only an Approver approves, never Claude, and a change sends an approved document back to review", async () => {
    const id = await add(creator, "To approve");
    expect(await errorCode(edit(creator, id, "status = 'approved'"))).toBe(PV004);
    expect(await errorCode(edit(approver, id, "status = 'approved'", [], "MCP"))).toBe(PV004);
    await edit(approver, id, "status = 'approved'");
    expect(await row(id)).toMatchObject({ status: "approved", approved_by: approver });
    await edit(creator, id, "body = $2", ["changed after approval"]);
    expect(await row(id)).toMatchObject({ status: "in_review", approved_by: null, approved_at: null, version: 2 });
  });
  it("a new document cannot start approved", async () => {
    const id = await db.asUser(approver, async (q) => (await q("insert into public.workspace_documents (tenant_id, title, status) values ($1, 'Sneaky', 'approved') returning id", [f.tenantA])).rows[0].id as string, { commit: true, via: "UI" });
    expect((await row(id)).status).toBe("draft");
  });
});
