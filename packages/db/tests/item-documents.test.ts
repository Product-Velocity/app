import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, approver: string;
let item: string;
const PV004 = "PV004";
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "docs-creator@example.test");
  viewer = await createUser(db, "docs-viewer@example.test");
  approver = await createUser(db, "docs-approver@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, approver, "creator");
  await db.admin.query("update public.tenant_members set is_approver = true where tenant_id = $1 and user_id = $2", [f.tenantA, approver]);
  item = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'With a PRD', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

const add = (user: string, title = "PRD", body = "# PRD", via = "UI") =>
  db.asUser(user, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'prd', $3, $4) returning id", [f.tenantA, item, title, body])).rows[0].id as string, { commit: true, via });
const edit = (user: string, id: string, set: string, params: unknown[] = [], via = "UI") =>
  db.asUser(user, async (q) => (await q(`update public.item_documents set ${set} where id = $1`, [id, ...params])).rowCount, { commit: true, via });
const row = async (id: string) => (await db.admin.query("select * from public.item_documents where id = $1", [id])).rows[0];

describe("documents on an initiative", () => {
  it("a creator adds a document; version 1 is saved and the write is audited", async () => {
    const id = await add(creator, "PRD v1", "# First");
    expect(await row(id)).toMatchObject({ version: 1, status: "draft", ai_draft: false, created_via: "UI" });
    const v = (await db.admin.query("select version, body from public.item_document_versions where document_id = $1", [id])).rows;
    expect(v).toEqual([{ version: 1, body: "# First" }]);
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_documents' and entity_id = $1 limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
  });

  it("editing the text bumps the version and keeps the old one; other edits do not", async () => {
    const id = await add(creator, "PRD", "one");
    await edit(creator, id, "body = $2", ["two"]);
    await edit(creator, id, "status = 'in_review'");
    expect(await row(id)).toMatchObject({ version: 2, status: "in_review", body: "two" });
    const v = (await db.admin.query("select version, body from public.item_document_versions where document_id = $1 order by version", [id])).rows;
    expect(v).toEqual([{ version: 1, body: "one" }, { version: 2, body: "two" }]);
  });

  it("the audit log records the size of the text, never the text", async () => {
    const id = await add(creator, "Audit", "secret roadmap text");
    await edit(creator, id, "body = $2", ["changed secret text"]);
    const rows = (await db.admin.query("select field, old, new from public.audit_log where entity = 'item_documents' and entity_id = $1 and field = 'body' order by id", [id])).rows;
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(rows[1].new).toEqual({ characters: 19 });
  });

  it("accepts the discovery kind (issue #244) and still refuses an unknown one", async () => {
    const id = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'discovery', 'Discovery: X', '# D') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
    expect((await row(id)).kind).toBe("discovery");
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_documents (tenant_id, item_id, kind, title) values ($1, $2, 'discoveries', 'x')", [f.tenantA, item]), { via: "UI" }))).toBe(CHECK);
  });

  it("refuses an empty title, a bad kind and a text over the limit", async () => {
    expect(await errorCode(add(creator, "  "))).toBe(CHECK);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_documents (tenant_id, item_id, kind, title) values ($1, $2, 'memo', 'x')", [f.tenantA, item]), { via: "UI" }))).toBe(CHECK);
    expect(await errorCode(add(creator, "Big", "x".repeat(200001)))).toBe(CHECK);
  });

  it("viewers cannot add, edit or delete; another workspace sees nothing", async () => {
    expect(await errorCode(add(viewer))).not.toBe(null);
    const id = await add(creator, "Mine");
    expect(await edit(viewer, id, "title = 'x'")).toBe(0);
    expect(await db.asUser(viewer, async (q) => (await q("delete from public.item_documents where id = $1", [id])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_documents where id = $1", [id])).rowCount)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_document_versions where document_id = $1", [id])).rowCount)).toBe(0);
    expect(await edit(f.bob, id, "title = 'x'")).toBe(0);
  });

  it("versions cannot be written by a client", async () => {
    const id = await add(creator, "Locked versions");
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_document_versions (tenant_id, document_id, version, title, body) values ($1, $2, 9, 'x', 'x')", [f.tenantA, id]), { via: "UI" }))).not.toBe(null);
    expect(await db.asUser(creator, async (q) => (await q("update public.item_document_versions set body = 'x' where document_id = $1", [id])).rowCount ?? 0, { commit: true }).catch(() => 0)).toBe(0);
  });
});

describe("Claude and approval", () => {
  it("a document written with a Claude token is an AI draft, whatever the client sends, and Claude cannot flip it", async () => {
    const id = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, title, body, kind) values ($1, $2, 'From Claude', 'x', 'prd') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "Claude MCP" });
    expect(await row(id)).toMatchObject({ ai_draft: true, created_via: "Claude MCP" });
    expect(await errorCode(edit(creator, id, "ai_draft = false", [], "Claude MCP"))).toBe(PV004);
    await edit(creator, id, "ai_draft = false"); // a person accepts it
    expect((await row(id)).ai_draft).toBe(false);
  });

  it("only an Approver approves; Claude never does; a client cannot set approval fields", async () => {
    const id = await add(creator, "To approve");
    await edit(creator, id, "status = 'in_review'");
    expect(await errorCode(edit(creator, id, "status = 'approved'"))).toBe(PV004);
    expect(await errorCode(edit(approver, id, "status = 'approved'", [], "Claude MCP"))).toBe(PV004);
    expect(await errorCode(db.asUser(approver, (q) => q("update public.item_documents set approved_by = $2 where id = $1", [id, approver]), { via: "UI" }))).not.toBe(null);
    await edit(approver, id, "status = 'approved'");
    expect(await row(id)).toMatchObject({ status: "approved", approved_by: approver });
    expect((await row(id)).approved_at).not.toBeNull();
  });

  it("a new document cannot start approved, and changing an approved document sends it back to review", async () => {
    const id = await db.asUser(approver, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, title, status) values ($1, $2, 'Sneaky', 'approved') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
    expect((await row(id)).status).toBe("draft");
    await edit(approver, id, "status = 'approved'");
    await edit(creator, id, "body = $2", ["edited after approval"]);
    expect(await row(id)).toMatchObject({ status: "in_review", approved_by: null, approved_at: null, version: 2 });
  });
});
