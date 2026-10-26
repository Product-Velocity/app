import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;
let item: string;
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "desc-creator@example.test");
  viewer = await createUser(db, "desc-viewer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  item = (await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Described', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true, via: "UI" }));
});
afterAll(async () => { await db.close(); });

describe("Description (N44)", () => {
  it("a creator writes Markdown up to 20,000 characters; it is audited with actor and source", async () => {
    const md = "## Goal\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    await db.asUser(creator, (q) => q("update public.items set description = $2 where id = $1", [item, md]), { via: "UI", commit: true });
    expect((await db.admin.query("select description from public.items where id = $1", [item])).rows[0].description).toBe(md);
    const a = (await db.admin.query("select new #>> '{}' as v, actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'description' order by id desc limit 1", [item])).rows[0];
    expect(a).toMatchObject({ v: md, actor_id: creator, via: "UI" });
    await db.asUser(creator, (q) => q("update public.items set description = $2 where id = $1", [item, "x".repeat(20000)]), { via: "UI", commit: true });
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set description = $2 where id = $1", [item, "x".repeat(20001)]), { via: "UI" }))).toBe(CHECK);
  });
  it("viewers cannot change it, and another workspace cannot reach it", async () => {
    expect(await errorCode(db.asUser(viewer, (q) => q("update public.items set description = 'no' where id = $1", [item]), { via: "UI" }))).toBe(null);
    expect((await db.admin.query("select description from public.items where id = $1", [item])).rows[0].description).not.toBe("no");
    expect(await db.asUser(f.bob, async (q) => (await q("update public.items set description = 'no' where id = $1", [item])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("select description from public.items where id = $1", [item])).rowCount)).toBe(0);
  });
  it("is writable as Claude (it is a text field, not rank, decision or value) and stays attributed to Claude MCP", async () => {
    await db.asUser(creator, (q) => q("update public.items set description = 'drafted by an agent' where id = $1", [item]), { via: "Claude MCP", commit: true });
    const a = (await db.admin.query("select via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'description' order by id desc limit 1", [item])).rows[0];
    expect(a.via).toBe("Claude MCP");
  });
});
