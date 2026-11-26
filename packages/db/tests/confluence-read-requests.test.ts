import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #721: item_confluence_read_requests, a request (by a person or by Claude) that a Confluence page be read into a document (import), or that a
// document be updated from its page (refresh). A request reads and writes nothing else; the link itself (item_document_pages) still refuses an assistant.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, claudeUser: string, otherItem: string;
let item: string, doc: string;
const CLIENT = "client-read-requests";
const claims = { client_id: CLIENT };
const URL1 = "https://acme.atlassian.net/wiki/spaces/GTM/pages/42/Plan";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "rr-creator@example.test");
  viewer = await createUser(db, "rr-viewer@example.test");
  claudeUser = await createUser(db, "rr-claude@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, claudeUser, "creator");
  await db.asUser(claudeUser, (q) => q("select public.mcp_connect($1, $2, 'Claude')", [f.tenantA, CLIENT]), { commit: true });
  item = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Read me', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id, { commit: true, via: "UI" });
  otherItem = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Another', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id, { commit: true, via: "UI" });
  doc = await db.asUser(creator, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, kind, title, body) values ($1, $2, 'go_to_market', 'GTM', '# GTM') returning id", [f.tenantA, item])).rows[0].id, { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

const ask = (user: string, o: Record<string, unknown>, opts: { claims?: Record<string, unknown> } = {}) => {
  const r = { tenant_id: f.tenantA, item_id: item, ...o };
  const cols = Object.keys(r);
  return db.asUser(user, async (q) => (await q(`insert into public.item_confluence_read_requests (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(r))).rows[0].id as string, { commit: true, via: opts.claims ? "MCP" : "UI", ...opts });
};
const rows = async () => (await db.admin.query("select * from public.item_confluence_read_requests where item_id = $1", [item])).rows;
const clear = () => db.admin.query("delete from public.item_confluence_read_requests where item_id = $1", [item]);

describe("requests to read a Confluence page", () => {
  it("a person records an import request and a refresh request; they are audited with the person", async () => {
    const a = await ask(creator, { kind: "import", page_url: URL1, doc_kind: "go_to_market", sync_direction: "both", note: "Plan lives here" });
    const b = await ask(creator, { kind: "refresh", document_id: doc });
    expect((await rows()).map((r) => [r.kind, r.created_via, r.created_by])).toEqual(expect.arrayContaining([["import", "UI", creator], ["refresh", "UI", creator]]));
    expect((await db.admin.query("select actor_id from public.audit_log where entity = 'item_confluence_read_requests' and entity_id = $1 limit 1", [a])).rows[0]).toMatchObject({ actor_id: creator });
    expect(b).toBeTruthy();
    await clear();
  });

  it("Claude may ask (recorded as MCP with the model it states) and withdraw, but still cannot link a page", async () => {
    const id = await ask(claudeUser, { kind: "import", page_url: URL1, ai_model: "Claude Sonnet 5.5" }, { claims });
    expect((await rows())[0]).toMatchObject({ id, created_via: "MCP", ai_model: "Claude Sonnet 5.5", sync_direction: "from_confluence", sync_mode: "sync" });
    const link = { tenant_id: f.tenantA, item_id: item, document_id: doc, site_id: "s", space_key: "GTM", page_id: "42", page_url: URL1, sync_mode: "sync", published_version: 1 };
    const cols = Object.keys(link);
    expect(await errorCode(db.asUser(claudeUser, (q) => q(`insert into public.item_document_pages (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(link)), { claims, commit: true, via: "MCP" }))).toBe("PV035");
    await db.asUser(claudeUser, (q) => q("delete from public.item_confluence_read_requests where id = $1", [id]), { claims, commit: true, via: "MCP" });
    expect(await rows()).toHaveLength(0);
  });

  it("one open request per page and initiative, and per document; asking again is an update, not a second row", async () => {
    await ask(creator, { kind: "import", page_url: URL1 });
    expect(await errorCode(ask(creator, { kind: "import", page_url: URL1 }))).toBe("23505");
    await ask(creator, { kind: "refresh", document_id: doc });
    expect(await errorCode(ask(creator, { kind: "refresh", document_id: doc }))).toBe("23505");
    await db.asUser(creator, (q) => q("update public.item_confluence_read_requests set note = 'again', sync_direction = 'both' where item_id = $1 and kind = 'import'", [item]), { commit: true, via: "UI" });
    expect((await rows()).find((r) => r.kind === "import")).toMatchObject({ note: "again", sync_direction: "both" });
    await clear();
  });

  it("the shape is checked: an import names an address and no document, a refresh a document and no address; the document must be on the initiative", async () => {
    expect(await errorCode(ask(creator, { kind: "import" }))).toBe("23514");
    expect(await errorCode(ask(creator, { kind: "import", page_url: URL1, document_id: doc }))).toBe("23514");
    expect(await errorCode(ask(creator, { kind: "import", page_url: "http://insecure.test/pages/1" }))).toBe("23514");
    expect(await errorCode(ask(creator, { kind: "refresh", page_url: URL1 }))).toBe("PV036"); // no document on the initiative
    expect(await errorCode(ask(creator, { kind: "refresh", document_id: doc, item_id: otherItem }))).toBe("PV036");
    expect(await errorCode(ask(creator, { kind: "import", page_url: URL1, sync_direction: "to_confluence" }))).toBe("23514");
  });

  it("a request cannot be moved to another page or document; a viewer cannot write; another workspace sees nothing", async () => {
    const id = await ask(creator, { kind: "import", page_url: URL1 });
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_confluence_read_requests set page_url = 'https://x.test/pages/9' where id = $1", [id]), { commit: true, via: "UI" }))).toBe("42501");
    expect(await errorCode(ask(viewer, { kind: "import", page_url: "https://acme.atlassian.net/wiki/spaces/GTM/pages/43/Other" }))).toBe("42501");
    const bobSees = await db.asUser(f.bob, async (q) => (await q("select count(*)::int as n from public.item_confluence_read_requests where item_id = $1", [item])).rows[0].n);
    expect(bobSees).toBe(0);
    await clear();
  });
});
