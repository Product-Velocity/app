import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, other: string;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "leaver@example.test");
  other = await createUser(db, "stayer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, other, "creator");
});
afterAll(async () => {
  await db.close();
});

const count = async (tenant: string, user: string) => (await db.admin.query("select count(*)::int as n from public.tenant_members where tenant_id = $1 and user_id = $2", [tenant, user])).rows[0].n as number;

describe("leaving a workspace", () => {
  it("a member can remove their own membership, and it is audited with them as the actor", async () => {
    await db.asUser(creator, (q) => q("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, creator]), { commit: true, via: "UI" });
    expect(await count(f.tenantA, creator)).toBe(0);
    const a = await db.admin.query("select actor_id, via from public.audit_log where tenant_id = $1 and entity = 'tenant_members' and field = 'user_id' and old = to_jsonb($2::text) order by id desc limit 1", [f.tenantA, creator]);
    expect(a.rows[0]).toMatchObject({ actor_id: creator, via: "UI" });
  });
  it("a member cannot remove someone else, in their workspace or another", async () => {
    await db.asUser(other, (q) => q("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, f.alice]), { commit: true });
    await db.asUser(other, (q) => q("delete from public.tenant_members where tenant_id = $1", [f.tenantB]), { commit: true });
    expect(await count(f.tenantA, f.alice)).toBe(1);
    expect(await count(f.tenantB, f.bob)).toBe(1);
  });
  it("the only admin cannot leave (PV003)", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, f.alice])))).toBe("PV003");
    expect(await count(f.tenantA, f.alice)).toBe(1);
  });
});
