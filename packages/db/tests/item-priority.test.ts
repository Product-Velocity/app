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
  creator = await createUser(db, "prio-creator@example.test");
  viewer = await createUser(db, "prio-viewer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  item = await db.asUser(creator, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Prioritised', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string, { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

describe("Priority (N45)", () => {
  it("a creator sets P0 to P3 and clears it; each change is audited with actor and source", async () => {
    for (const p of ["P0", "P3", null]) await db.asUser(creator, (q) => q("update public.items set priority = $2 where id = $1", [item, p]), { via: "UI", commit: true });
    const a = (await db.admin.query("select new #>> '{}' as v, old #>> '{}' as o, actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'priority' order by id desc limit 2", [item])).rows;
    expect(a[1]).toMatchObject({ v: "P3", o: "P0", actor_id: creator, via: "UI" });
    expect(a[0].v).toBeNull();
  });
  it("only P0 to P3 are accepted", async () => {
    for (const bad of ["P4", "p1", "High", ""]) expect(await errorCode(db.asUser(creator, (q) => q("update public.items set priority = $2 where id = $1", [item, bad]), { via: "UI" }))).toBe(CHECK);
  });
  it("is independent of MoSCoW", async () => {
    await db.asUser(creator, (q) => q("update public.items set priority = 'P2', moscow = 'Must' where id = $1", [item]), { via: "UI", commit: true });
    const r = (await db.admin.query("select priority, moscow from public.items where id = $1", [item])).rows[0];
    expect(r).toEqual({ priority: "P2", moscow: "Must" });
  });
  it("viewers cannot change it, and another workspace cannot reach it", async () => {
    expect(await db.asUser(viewer, async (q) => (await q("update public.items set priority = 'P0' where id = $1", [item])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.items set priority = 'P0' where id = $1", [item])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("select priority from public.items where id = $1", [item])).rowCount)).toBe(0);
    expect((await db.admin.query("select priority from public.items where id = $1", [item])).rows[0].priority).toBe("P2");
  });
});
