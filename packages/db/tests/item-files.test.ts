import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;
let item: string;
const CHECK = "23514";
const UNIQUE = "23505";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "files-creator@example.test");
  viewer = await createUser(db, "files-viewer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  item = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'With files', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

const add = (user: string, name: string, extra = "'image/png', 2048", shared = true) =>
  db.asUser(user, async (q) => (await q(`insert into public.item_attachments (tenant_id, item_id, kind, file_kind, name, storage_path, mime_type, size_bytes, shared) values ($1, $2, 'file', 'image', $3, $4, ${extra}, ${shared}) returning id`, [f.tenantA, item, name, `${f.tenantA}/${name}`])).rows[0].id as string, { commit: true, via: "UI" });
const token = async (id: string) => (await db.admin.query("select share_token from public.item_attachments where id = $1", [id])).rows[0].share_token as string | null;

describe("file attachments with share links", () => {
  it("a creator adds a file with type and size; the write is audited", async () => {
    const id = await add(creator, "mock.png");
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_attachments' and entity_id = $1 limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
  });
  it("refuses types outside the allow-list and impossible sizes", async () => {
    expect(await errorCode(add(creator, "x.svg", "'image/svg+xml', 10"))).toBe(CHECK);
    expect(await errorCode(add(creator, "big.png", "'image/png', 10485761"))).toBe(CHECK);
    expect(await errorCode(add(creator, "zero.png", "'image/png', 0"))).toBe(CHECK);
  });
  it("a shared file gets a link made by the database; not sharing removes it; sharing again makes a new address", async () => {
    const id = await add(creator, "share.png");
    const first = await token(id);
    expect(first).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    const set = (sql: string) => db.asUser(creator, (q) => q(`update public.item_attachments set ${sql} where id = $1`, [id]), { commit: true, via: "UI" });
    await set("shared = false");
    expect(await token(id)).toBeNull();
    await set("shared = true");
    const second = await token(id);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first); // an old, leaked address stays dead
    await set("share_token = null"); // asking for a new address
    expect(await token(id)).not.toBe(second);
  });
  it("a token chosen by the client is replaced, and a file added as not shared has none", async () => {
    const id = await add(creator, "chosen.png");
    await db.asUser(creator, (q) => q("update public.item_attachments set share_token = $2 where id = $1", [id, "A".repeat(43)]), { commit: true, via: "UI" });
    expect(await token(id)).not.toBe("A".repeat(43));
    expect(await token(await add(creator, "private.png", "'image/png', 2048", false))).toBeNull();
  });
  it("an attachment cannot change kind or stored file", async () => {
    const id = await add(creator, "kind.png");
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_attachments set kind = 'link' where id = $1", [id]), { via: "UI" }))).not.toBe(null);
  });
  it("links keep to http(s) addresses, never carry a token, and default to shared", async () => {
    const id = await db.asUser(creator, async (q) => (await q("insert into public.item_attachments (tenant_id, item_id, kind, name, url) values ($1, $2, 'link', 'Figma', 'https://example.test/f') returning id", [f.tenantA, item])).rows[0].id as string, { commit: true, via: "UI" });
    expect((await db.admin.query("select shared, share_token from public.item_attachments where id = $1", [id])).rows[0]).toEqual({ shared: true, share_token: null });
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_attachments (tenant_id, item_id, kind, url) values ($1, $2, 'link', 'javascript:alert(1)')", [f.tenantA, item])))).toBe(CHECK);
    await db.asUser(creator, (q) => q("update public.item_attachments set shared = false where id = $1", [id]), { commit: true, via: "UI" });
    expect((await db.admin.query("select shared from public.item_attachments where id = $1", [id])).rows[0].shared).toBe(false);
  });
  it("viewers cannot add files or change sharing", async () => {
    expect(await errorCode(add(viewer, "nope.png"))).not.toBe(null);
    const id = await add(creator, "viewer-test.png");
    const n = await db.asUser(viewer, async (q) => (await q("update public.item_attachments set shared = false where id = $1", [id])).rowCount, { commit: true });
    expect(n).toBe(0);
  });
  it("another workspace can neither see nor change them", async () => {
    const id = await add(creator, "tenant.png");
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_attachments where id = $1", [id])).rowCount)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.item_attachments set shared = false where id = $1", [id])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("delete from public.item_attachments where id = $1", [id])).rowCount, { commit: true })).toBe(0);
  });
});

describe("attachments written through a Claude connection (docs/20 FR-5)", () => {
  const claude = { claims: { client_id: "claude-client-1" }, commit: true };
  const addAsClaude = (user: string, name: string, tenant = f.tenantA, itemId = item) =>
    db.asUser(user, async (q) => (await q("insert into public.item_attachments (tenant_id, item_id, kind, file_kind, name, storage_path, mime_type, size_bytes, shared) values ($1, $2, 'file', 'image', $3, $4, 'image/png', 2048, false) returning id", [tenant, itemId, name, `${tenant}/${name}`])).rows[0].id as string, claude);

  it("upload, sharing change and removal are audited with source MCP and the person as actor", async () => {
    const id = await addAsClaude(creator, "claude.png");
    await db.asUser(creator, (q) => q("update public.item_attachments set shared = true where id = $1", [id]), claude);
    await db.asUser(creator, (q) => q("update public.item_attachments set shared = false where id = $1", [id]), claude);
    await db.asUser(creator, (q) => q("delete from public.item_attachments where id = $1", [id]), claude);
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'item_attachments' and entity_id = $1 order by id", [id]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r).toMatchObject({ via: "MCP", actor_id: creator });
    expect(rows.some((r) => r.field === "share_token")).toBe(true);
  });

  it("a viewer's connection cannot upload, share or remove", async () => {
    const id = await add(creator, "viewer-claude.png");
    expect(await errorCode(addAsClaude(viewer, "nope.png"))).not.toBe(null);
    expect(await db.asUser(viewer, async (q) => (await q("update public.item_attachments set shared = false where id = $1", [id])).rowCount, claude)).toBe(0);
    expect(await db.asUser(viewer, async (q) => (await q("delete from public.item_attachments where id = $1", [id])).rowCount, claude)).toBe(0);
  });

  it("another workspace's ids are not reachable, and nothing can be attached to another workspace's initiative", async () => {
    const id = await add(creator, "tenant-claude.png");
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_attachments where id = $1", [id])).rowCount, claude)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.item_attachments set shared = false where id = $1", [id])).rowCount, claude)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("delete from public.item_attachments where id = $1", [id])).rowCount, claude)).toBe(0);
    expect(await errorCode(addAsClaude(f.bob, "cross.png", f.tenantA))).not.toBe(null);
    expect((await db.admin.query("select 1 from public.item_attachments where id = $1", [id])).rowCount).toBe(1);
  });
});

describe("the migration from item_files and item_links", () => {
  it("is covered by a fresh database applying every migration (the rewritten functions are exercised by the MCP and copy tests)", async () => {
    expect((await db.admin.query("select to_regclass('public.item_links') as l, to_regclass('public.item_files') as f")).rows[0]).toEqual({ l: null, f: null });
  });
});
