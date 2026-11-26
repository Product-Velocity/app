import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #693, slice B: item_document_pages, the page a document was published to. Row-level security, the role rules, the refusal of an
// assistant (PV035), integrity (PV036), one live publication per document, and the audit trail.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, claudeUser: string;
let item: string, doc: string;
const CLIENT = "client-pages";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "pages-creator@example.test");
  viewer = await createUser(db, "pages-viewer@example.test");
  claudeUser = await createUser(db, "pages-claude@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, claudeUser, "creator");
  await db.asUser(claudeUser, (q) => q("select public.mcp_connect($1, $2, 'Claude')", [f.tenantA, CLIENT]), { commit: true });
  item = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Published', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true });
  doc = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'prd', 'PRD', '# PRD') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

const page = (over: Record<string, unknown> = {}) => ({ tenant_id: f.tenantA, item_id: item, document_id: doc, site_id: "site-1", space_key: "PRD", page_id: "12345", page_url: "https://example.atlassian.net/wiki/spaces/PRD/pages/12345", page_title: "PRD", sync_mode: "once", published_version: 1, remote_version: 1, ...over });
const insert = (user: string, o: Record<string, unknown> = {}, opts: { via?: string; claims?: Record<string, unknown> } = {}) => {
  const r = page(o);
  const cols = Object.keys(r);
  return db.asUser(user, async (q) => (await q(`insert into public.item_document_pages (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(r))).rows[0].id as string, { commit: true, ...(opts.claims ? { claims: opts.claims } : { via: opts.via ?? "UI" }) });
};
const all = async () => (await db.admin.query("select * from public.item_document_pages where document_id = $1 order by created_at", [doc])).rows;
const unlink = () => db.asUser(creator, (q) => q("update public.item_document_pages set unlinked_at = now() where document_id = $1 and unlinked_at is null", [doc]), { commit: true, via: "UI" });

describe("pages a document was published to", () => {
  it("a creator records a publication; the write is audited with the person and the source", async () => {
    const id = await insert(creator);
    expect((await all())[0]).toMatchObject({ id, provider: "confluence", source: "pv", sync_mode: "once", created_via: "UI", created_by: creator, unlinked_at: null });
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_document_pages' and entity_id = $1 limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
  });

  it("only one live publication per document; an unlinked one stays as history and a new one can follow", async () => {
    expect(await errorCode(insert(creator, { page_id: "999" }))).toBe("23505");
    await unlink();
    await insert(creator, { page_id: "999", sync_mode: "sync" });
    const rows = await all();
    expect(rows.map((r) => [r.page_id, r.unlinked_at !== null])).toEqual([["12345", true], ["999", false]]);
  });

  it("everyone in the workspace reads them; a viewer cannot write; another workspace sees and changes nothing", async () => {
    expect((await db.asUser(viewer, (q) => q("select id from public.item_document_pages where document_id = $1", [doc]))).rowCount).toBe(2);
    expect(await errorCode(insert(viewer, { page_id: "55" }))).toBe("42501");
    expect((await db.asUser(f.bob, (q) => q("select id from public.item_document_pages where tenant_id = $1", [f.tenantA]))).rowCount).toBe(0);
    const upd = await db.asUser(f.bob, (q) => q("update public.item_document_pages set sync_mode = 'once' where tenant_id = $1", [f.tenantA]), { commit: true, via: "UI" });
    expect(upd.rowCount).toBe(0);
    expect(await errorCode(insert(f.bob, { tenant_id: f.tenantB }))).not.toBeNull(); // not a member of workspace A, and the document is not in workspace B
    const gone = await db.asUser(f.bob, (q) => q("delete from public.item_document_pages where tenant_id = $1", [f.tenantA]), { commit: true, via: "UI" });
    expect(gone.rowCount).toBe(0);
  });

  it("an assistant cannot record, change or remove a publication (PV035): it can prepare, a person sends", async () => {
    const claims = { client_id: CLIENT };
    expect(await errorCode(insert(claudeUser, { page_id: "777" }, { claims }))).toBe("PV035");
    expect(await errorCode(db.asUser(claudeUser, (q) => q("update public.item_document_pages set sync_mode = 'once' where document_id = $1", [doc]), { commit: true, claims }))).toBe("PV035");
    expect(await errorCode(db.asUser(claudeUser, (q) => q("delete from public.item_document_pages where document_id = $1", [doc]), { commit: true, claims }))).toBe("PV035");
    expect((await all()).length).toBe(2);
  });

  it("a publication stays on its own document and page (PV036), and a document of another initiative is refused", async () => {
    const other = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Other', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true });
    await unlink();
    expect(await errorCode(insert(creator, { item_id: other, page_id: "4242" }))).toBe("PV036");
    await insert(creator, { page_id: "31" });
    // the page and the space are not columns a person may update at all (privilege), and the trigger refuses it as well for any other writer
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_document_pages set page_id = '31337' where document_id = $1 and unlinked_at is null", [doc]), { commit: true, via: "UI" }))).toBe("42501");
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_document_pages set space_key = 'ELSE' where document_id = $1 and unlinked_at is null", [doc]), { commit: true, via: "UI" }))).toBe("42501");
    expect(await errorCode(db.asService((q) => q("update public.item_document_pages set page_id = '31337' where document_id = $1 and unlinked_at is null", [doc]), { commit: true }))).toBe("PV036");
  });

  it("the columns a person may set are limited: no hand-written creator, and the page address must be https", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_document_pages set created_by = $2 where document_id = $1", [doc, viewer]), { commit: true, via: "UI" }))).toBe("42501");
    await unlink();
    expect(await errorCode(insert(creator, { page_url: "http://example.test/x", page_id: "1" }))).toBe("23514");
    expect(await errorCode(insert(creator, { page_id: "not-a-number" }))).toBe("23514");
  });

  it("removing the document removes its publications (the page stays in Confluence)", async () => {
    const d2 = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'prd', 'Gone', 'x') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
    await insert(creator, { document_id: d2, page_id: "2024" });
    await db.asUser(creator, (q) => q("delete from public.item_documents where id = $1", [d2]), { commit: true, via: "UI" });
    expect((await db.admin.query("select 1 from public.item_document_pages where document_id = $1", [d2])).rowCount).toBe(0);
  });
});
