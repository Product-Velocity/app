import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

const list = (userId: string, tenant: string) =>
  db.asUser(userId, async (q) => (await q("select * from public.tenant_directory($1)", [tenant])).rows);

describe("tenant_directory", () => {
  it("lists members of the caller's own tenant with email, role and Approver flag", async () => {
    const rows = await list(f.alice, f.tenantA);
    expect(rows.map((r) => [r.email, r.role, r.is_approver])).toEqual([
      ["alice@example.test", "admin", false],
      ["carol@example.test", "viewer", false],
    ]);
  });

  it("any member can read it, a viewer included", async () => {
    expect(await list(f.carol, f.tenantA)).toHaveLength(2);
  });

  it("returns nothing for another tenant, in both directions", async () => {
    expect(await list(f.alice, f.tenantB)).toEqual([]);
    expect(await list(f.bob, f.tenantA)).toEqual([]);
    expect(await list(f.dave, f.tenantA)).toEqual([]);
  });

  it("is not available to anonymous callers", async () => {
    expect(await errorCode(db.asAnon((q) => q("select * from public.tenant_directory($1)", [f.tenantA])))).toBe("42501");
  });
});
