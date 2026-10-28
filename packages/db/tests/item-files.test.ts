import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;
let item: string;
const CHECK = "23514";
const UNIQUE = "23505";
const TOKEN = "A".repeat(43);

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

const add = (user: string, name: string, extra = "'image/png', 2048") =>
  db.asUser(user, async (q) => (await q(`insert into public.item_files (tenant_id, item_id, kind, name, storage_path, mime_type, size_bytes) values ($1, $2, 'image', $3, $4, ${extra}) returning id`, [f.tenantA, item, name, `${f.tenantA}/${name}`])).rows[0].id as string, { commit: true, via: "UI" });

describe("item files with share links", () => {
  it("a creator adds a file with type and size; the write is audited", async () => {
    const id = await add(creator, "mock.png");
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_files' and entity_id = $1 limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
  });
  it("refuses types outside the allow-list and impossible sizes", async () => {
    expect(await errorCode(add(creator, "x.svg", "'image/svg+xml', 10"))).toBe(CHECK);
    expect(await errorCode(add(creator, "big.png", "'image/png', 10485761"))).toBe(CHECK);
    expect(await errorCode(add(creator, "zero.png", "'image/png', 0"))).toBe(CHECK);
  });
  it("a creator turns a share link on and off; tokens are unique and must be long enough", async () => {
    const id = await add(creator, "share.png");
    const set = (t: string | null) => db.asUser(creator, (q) => q("update public.item_files set share_token = $2, share_updated_at = now() where id = $1", [id, t]), { commit: true, via: "UI" });
    await set(TOKEN);
    expect((await db.admin.query("select share_token from public.item_files where id = $1", [id])).rows[0].share_token).toBe(TOKEN);
    const other = await add(creator, "other.png");
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_files set share_token = $2 where id = $1", [other, TOKEN]), { via: "UI" }))).toBe(UNIQUE);
    expect(await errorCode(set("short"))).toBe(CHECK);
    await set(null);
    expect((await db.admin.query("select share_token from public.item_files where id = $1", [id])).rows[0].share_token).toBeNull();
  });
  it("viewers cannot add files or change share links", async () => {
    expect(await errorCode(add(viewer, "nope.png"))).not.toBe(null);
    const id = await add(creator, "viewer-test.png");
    const n = await db.asUser(viewer, async (q) => (await q("update public.item_files set share_token = $2 where id = $1", [id, "B".repeat(43)])).rowCount, { commit: true });
    expect(n).toBe(0);
  });
  it("another workspace can neither see nor change them", async () => {
    const id = await add(creator, "tenant.png");
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_files where id = $1", [id])).rowCount)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.item_files set share_token = $2 where id = $1", [id, "C".repeat(43)])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("delete from public.item_files where id = $1", [id])).rowCount, { commit: true })).toBe(0);
  });
});

describe("files written through a Claude connection (docs/20 FR-5)", () => {
  const claude = { claims: { client_id: "claude-client-1" }, commit: true };
  const addAsClaude = (user: string, name: string, tenant = f.tenantA, itemId = item) =>
    db.asUser(user, async (q) => (await q("insert into public.item_files (tenant_id, item_id, kind, name, storage_path, mime_type, size_bytes) values ($1, $2, 'image', $3, $4, 'image/png', 2048) returning id", [tenant, itemId, name, `${tenant}/${name}`])).rows[0].id as string, claude);

  it("upload, sharing change and removal are audited with source Claude MCP and the person as actor", async () => {
    const id = await addAsClaude(creator, "claude.png");
    await db.asUser(creator, (q) => q("update public.item_files set share_token = $2, share_updated_at = now() where id = $1", [id, "D".repeat(43)]), claude);
    await db.asUser(creator, (q) => q("update public.item_files set share_token = null, share_updated_at = now() where id = $1", [id]), claude);
    await db.asUser(creator, (q) => q("delete from public.item_files where id = $1", [id]), claude);
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'item_files' and entity_id = $1 order by id", [id]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r).toMatchObject({ via: "Claude MCP", actor_id: creator });
    expect(rows.some((r) => r.field === "share_token")).toBe(true);
  });

  it("a viewer's connection cannot upload, share or remove", async () => {
    const id = await add(creator, "viewer-claude.png");
    expect(await errorCode(addAsClaude(viewer, "nope.png"))).not.toBe(null);
    expect(await db.asUser(viewer, async (q) => (await q("update public.item_files set share_token = $2 where id = $1", [id, "E".repeat(43)])).rowCount, claude)).toBe(0);
    expect(await db.asUser(viewer, async (q) => (await q("delete from public.item_files where id = $1", [id])).rowCount, claude)).toBe(0);
  });

  it("another workspace's file ids are not reachable, and nothing can be attached to another workspace's initiative", async () => {
    const id = await add(creator, "tenant-claude.png");
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_files where id = $1", [id])).rowCount, claude)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.item_files set share_token = $2 where id = $1", [id, "F".repeat(43)])).rowCount, claude)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("delete from public.item_files where id = $1", [id])).rowCount, claude)).toBe(0);
    expect(await errorCode(addAsClaude(f.bob, "cross.png", f.tenantA))).not.toBe(null);
    expect((await db.admin.query("select 1 from public.item_files where id = $1", [id])).rowCount).toBe(1);
  });
});
