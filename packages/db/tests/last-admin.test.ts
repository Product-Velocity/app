import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

const LAST_ADMIN = "PV003";

describe("a tenant always keeps one admin", () => {
  it("the only admin cannot demote or remove themselves", async () => {
    const demote = db.asUser(f.alice, (q) => q("update public.tenant_members set role = 'viewer' where user_id = $1", [f.alice]));
    expect(await errorCode(demote)).toBe(LAST_ADMIN);
    const remove = db.asUser(f.alice, (q) => q("delete from public.tenant_members where user_id = $1", [f.alice]));
    expect(await errorCode(remove)).toBe(LAST_ADMIN);
    // not even the service role may orphan a tenant
    expect(await errorCode(db.asService((q) => q("delete from public.tenant_members where user_id = $1", [f.alice])))).toBe(LAST_ADMIN);
  });

  it("with a second admin, either can step down", async () => {
    await db.asUser(f.alice, (q) => q("update public.tenant_members set role = 'admin' where user_id = $1", [f.carol]), { commit: true });
    await db.asUser(f.alice, (q) => q("update public.tenant_members set role = 'creator' where user_id = $1", [f.alice]), { commit: true });
    // carol is now the only admin again
    expect(
      await errorCode(db.asUser(f.carol, (q) => q("update public.tenant_members set role = 'viewer' where user_id = $1", [f.carol]))),
    ).toBe(LAST_ADMIN);
  });

  it("other changes to the last admin are fine (Approver flag)", async () => {
    const n = await db.asUser(f.bob, async (q) => (await q("update public.tenant_members set is_approver = true where user_id = $1", [f.bob])).rowCount, { commit: true });
    expect(n).toBe(1);
  });

  it("deleting a whole tenant still works", async () => {
    const owner = await createUser(db, "solo@example.test");
    const t = await db.asUser(owner, async (q) => (await q("select public.create_tenant('Solo') as id")).rows[0].id as string, { commit: true });
    await db.admin.query("delete from public.tenants where id = $1", [t]);
    const { rows } = await db.admin.query("select 1 from public.tenant_members where tenant_id = $1", [t]);
    expect(rows).toHaveLength(0);
  });
});
