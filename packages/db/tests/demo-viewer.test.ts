import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

const DENIED = "42501";
const CHECK_VIOLATION = "23514";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

/**
 * The fixed, shared demo account behind the public "See the demo" button (issue #559,
 * packages/db/migrations/20261121084429_demo_viewer_account.sql). It is nothing but a normal
 * viewer that is also a service account, so every write it tries is denied the same way a
 * real viewer's or a real service account's would be.
 */
describe("demo viewer account", () => {
  it("can only ever be role viewer and a service account, and only the service role can set the flag", async () => {
    // not in the authenticated insert grant at all (packages/db/migrations/20261121084429): only the service role may set it
    const noGrant = await createUser(db, "demo-no-grant@example.test");
    await expect(
      errorCode(
        db.asUser(
          f.alice,
          (q) =>
            q(
              "insert into public.tenant_members (tenant_id, user_id, role, is_service_account, is_demo_account) values ($1, $2, 'viewer', true, true)",
              [f.tenantA, noGrant],
            ),
          { commit: true },
        ),
      ),
    ).resolves.not.toBeNull();

    const badRole = await createUser(db, "demo-bad-role@example.test");
    await expect(
      errorCode(
        db.asService((q) =>
          q(
            "insert into public.tenant_members (tenant_id, user_id, role, is_service_account, is_demo_account) values ($1, $2, 'admin', true, true)",
            [f.tenantA, badRole],
          ),
        ),
      ),
    ).resolves.toBe(CHECK_VIOLATION);

    const notService = await createUser(db, "demo-not-service@example.test");
    await expect(
      errorCode(
        db.asService((q) =>
          q(
            "insert into public.tenant_members (tenant_id, user_id, role, is_service_account, is_demo_account) values ($1, $2, 'viewer', false, true)",
            [f.tenantA, notService],
          ),
        ),
      ),
    ).resolves.toBe(CHECK_VIOLATION);
  });

  it("reads the tenant's items but cannot create, edit or delete them", async () => {
    const demo = await createUser(db, "demo-viewer@example.test");
    await addMember(db, f.alice, f.tenantA, demo, "viewer", { demoAccount: true });

    const rows = await db.asUser(demo, (q) => q("select id from public.items where tenant_id = $1", [f.tenantA]), { commit: false });
    expect(rows.rowCount).toBeGreaterThan(0);

    // items_update's USING clause silently matches zero rows for a non-editor: no error, nothing changes
    const updated = await db.asUser(demo, (q) => q("update public.items set initiative_name = 'pwned' where tenant_id = $1", [f.tenantA]));
    expect(updated.rowCount).toBe(0);
    await expect(
      errorCode(db.asUser(demo, (q) => q("insert into public.items (tenant_id, initiative_name) values ($1, 'New')", [f.tenantA]))),
    ).resolves.toBe(DENIED);
    await expect(
      errorCode(db.asUser(demo, (q) => q("delete from public.items where tenant_id = $1", [f.tenantA]))),
    ).resolves.toBe(DENIED);
  });

  it("cannot leave the workspace, change its own membership, or invite anyone", async () => {
    const demo = await createUser(db, "demo-viewer-2@example.test");
    await addMember(db, f.alice, f.tenantA, demo, "viewer", { demoAccount: true });

    // tenant_members_delete/_update require is_tenant_admin(): their USING clause silently matches zero rows for a viewer
    const deleted = await db.asUser(demo, (q) => q("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, demo]));
    expect(deleted.rowCount).toBe(0);
    const promoted = await db.asUser(demo, (q) => q("update public.tenant_members set role = 'admin' where tenant_id = $1 and user_id = $2", [f.tenantA, demo]));
    expect(promoted.rowCount).toBe(0);
    const still = await db.admin.query("select role from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, demo]);
    expect(still.rows[0]?.role).toBe("viewer");
    await expect(
      errorCode(
        db.asUser(demo, (q) =>
          q("insert into public.invitations (tenant_id, email, role, token_hash, created_by) values ($1, 'x@example.test', 'viewer', 'demo-test-hash', $2)", [f.tenantA, demo]),
        ),
      ),
    ).resolves.toBe(DENIED);
  });
});
