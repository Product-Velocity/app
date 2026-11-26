import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #693, slice C: item_document_publish_requests, a request (by a person or by Claude) that a document be published to Confluence.
// A request sends nothing, so an assistant may write it; the publication itself still refuses an assistant (item_document_pages, PV035).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, claudeUser: string;
let item: string, doc: string;
const CLIENT = "client-requests";
const claims = { client_id: CLIENT };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "req-creator@example.test");
  viewer = await createUser(db, "req-viewer@example.test");
  claudeUser = await createUser(db, "req-claude@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, claudeUser, "creator");
  await db.asUser(claudeUser, (q) => q("select public.mcp_connect($1, $2, 'Claude')", [f.tenantA, CLIENT]), { commit: true });
  item = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Requested', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true });
  doc = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'go_to_market', 'GTM', '# GTM') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

const request = (user: string, o: Record<string, unknown> = {}, opts: { claims?: Record<string, unknown> } = {}) => {
  const r = { tenant_id: f.tenantA, item_id: item, document_id: doc, space_key: "GTM", sync_mode: "sync", note: "Ready for the team", ...o };
  const cols = Object.keys(r);
  return db.asUser(user, async (q) => (await q(`insert into public.item_document_publish_requests (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(r))).rows[0].id as string, { commit: true, ...(opts.claims ? { claims: opts.claims } : { via: "UI" }) });
};
const rows = async () => (await db.admin.query("select * from public.item_document_publish_requests where document_id = $1", [doc])).rows;
const clear = () => db.admin.query("delete from public.item_document_publish_requests where document_id = $1", [doc]);

describe("requests to publish a document", () => {
  it("a person records a request; it is audited with the person and the source", async () => {
    const id = await request(creator);
    expect((await rows())[0]).toMatchObject({ id, provider: "confluence", space_key: "GTM", sync_mode: "sync", created_via: "UI", created_by: creator });
    expect((await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_document_publish_requests' and entity_id = $1 limit 1", [id])).rows[0]).toMatchObject({ actor_id: creator, via: "UI" });
    await clear();
  });

  it("Claude may ask: the request is recorded as MCP with the model it states; Claude may withdraw it too; but it still cannot publish", async () => {
    const id = await request(claudeUser, { ai_model: "Claude Sonnet 5.5", sync_mode: "once" }, { claims });
    expect((await rows())[0]).toMatchObject({ id, created_via: "MCP", ai_model: "Claude Sonnet 5.5", sync_mode: "once" });
    expect((await db.admin.query("select via from public.audit_log where entity = 'item_document_publish_requests' and entity_id = $1 limit 1", [id])).rows[0]).toMatchObject({ via: "MCP" });
    const page = { tenant_id: f.tenantA, item_id: item, document_id: doc, site_id: "s", space_key: "GTM", page_id: "1", page_url: "https://x.test/1", sync_mode: "once", published_version: 1 };
    const cols = Object.keys(page);
    expect(await errorCode(db.asUser(claudeUser, (q) => q(`insert into public.item_document_pages (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(page)), { commit: true, claims }))).toBe("PV035");
    await db.asUser(claudeUser, (q) => q("delete from public.item_document_publish_requests where document_id = $1", [doc]), { commit: true, claims });
    expect(await rows()).toEqual([]);
  });

  it("one open request per document: asking again replaces it (upsert), a second insert is refused", async () => {
    await request(creator);
    expect(await errorCode(request(creator, { space_key: "OTHER" }))).toBe("23505");
    await db.asUser(creator, (q) => q("update public.item_document_publish_requests set space_key = 'OTHER', sync_mode = 'once' where document_id = $1", [doc]), { commit: true, via: "UI" });
    expect((await rows())[0]).toMatchObject({ space_key: "OTHER", sync_mode: "once" });
    await clear();
  });

  it("everyone in the workspace reads them; a viewer cannot write; another workspace sees and changes nothing", async () => {
    await request(creator);
    expect((await db.asUser(viewer, (q) => q("select id from public.item_document_publish_requests where document_id = $1", [doc]))).rowCount).toBe(1);
    expect(await errorCode(request(viewer, { space_key: "X" }))).toBe("42501");
    expect((await db.asUser(f.bob, (q) => q("select id from public.item_document_publish_requests where tenant_id = $1", [f.tenantA]))).rowCount).toBe(0);
    expect((await db.asUser(f.bob, (q) => q("update public.item_document_publish_requests set note = 'x' where tenant_id = $1", [f.tenantA]), { commit: true, via: "UI" })).rowCount).toBe(0);
    expect((await db.asUser(f.bob, (q) => q("delete from public.item_document_publish_requests where tenant_id = $1", [f.tenantA]), { commit: true, via: "UI" })).rowCount).toBe(0);
    expect(await errorCode(request(f.bob, { tenant_id: f.tenantB }))).not.toBeNull();
    expect((await rows()).length).toBe(1);
    await clear();
  });

  it("the document must be on the same initiative (PV036) and cannot be changed; bad values are refused", async () => {
    const other = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Other', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true });
    expect(await errorCode(request(creator, { item_id: other }))).toBe("PV036");
    expect(await errorCode(request(creator, { space_key: "has space" }))).toBe("23514");
    expect(await errorCode(request(creator, { parent_url: "http://insecure.test/x" }))).toBe("23514");
    expect(await errorCode(request(creator, { sync_mode: "sometimes" }))).toBe("23514");
    expect(await errorCode(request(creator, { note: "x".repeat(501) }))).toBe("23514");
    await request(creator);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_document_publish_requests set document_id = $2 where document_id = $1", [doc, doc]), { commit: true, via: "UI" }))).toBe("42501");
    await clear();
  });

  it("removing the document removes its request", async () => {
    const d2 = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'other', 'Gone', 'x') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
    await request(creator, { document_id: d2 });
    await db.asUser(creator, (q) => q("delete from public.item_documents where id = $1", [d2]), { commit: true, via: "UI" });
    expect((await db.admin.query("select 1 from public.item_document_publish_requests where document_id = $1", [d2])).rowCount).toBe(0);
  });
});
