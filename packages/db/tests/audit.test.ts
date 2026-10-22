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

const auditFor = async (tenantId: string, entity: string, field?: string) =>
  (
    await db.admin.query(
      `select * from public.audit_log where tenant_id = $1 and entity = $2
       ${field ? "and field = $3" : ""} order by id`,
      field ? [tenantId, entity, field] : [tenantId, entity],
    )
  ).rows;

describe("audit log", () => {
  it("records tenant creation with actor and source", async () => {
    const rows = await auditFor(f.tenantA, "tenants", "name");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: f.alice, via: "API", old: null, new: "Tenant A" });
  });

  it("records old and new value on update, with the declared source", async () => {
    await db.asUser(f.alice, (q) => q("update public.tenants set name = 'Tenant A2' where id = $1", [f.tenantA]), {
      via: "UI",
      commit: true,
    });
    const rows = await auditFor(f.tenantA, "tenants", "name");
    expect(rows.at(-1)).toMatchObject({ actor_id: f.alice, via: "UI", old: "Tenant A", new: "Tenant A2" });
  });

  it("records membership changes and sets created_by / created_via", async () => {
    const { rows } = await db.admin.query(
      "select created_by, created_via from public.tenant_members where tenant_id = $1 and user_id = $2",
      [f.tenantA, f.carol],
    );
    expect(rows[0]).toMatchObject({ created_by: f.alice, created_via: "API" });
    const roleRows = await auditFor(f.tenantA, "tenant_members", "role");
    expect(roleRows.some((r) => r.new === "viewer")).toBe(true);
  });

  it("records service-role writes as system with no actor", async () => {
    await db.asService((q) => q("update public.tenants set name = 'Tenant B2' where id = $1", [f.tenantB]), {
      commit: true,
    });
    const rows = await auditFor(f.tenantB, "tenants", "name");
    expect(rows.at(-1)).toMatchObject({ actor_id: null, via: "system", new: "Tenant B2" });
  });

  it("rejects an unknown write source", async () => {
    const code = await errorCode(
      db.asUser(f.alice, (q) => q("update public.tenants set name = 'x' where id = $1", [f.tenantA]), {
        via: "hacker",
      }),
    );
    expect(code).toBe("P0001");
  });

  it("is append-only, even for the service role and superusers", async () => {
    for (const sql of [
      "update public.audit_log set field = 'x'",
      "delete from public.audit_log",
      "truncate public.audit_log",
    ]) {
      expect(await errorCode(db.asService((q) => q(sql))), sql).toBe("P0001");
      expect(await errorCode(db.admin.query(sql)), sql).toBe("P0001");
    }
  });

  it("keeps history after a tenant is deleted", async () => {
    const owner = await createUser(db, "erin@example.test");
    const t = await db.asUser(owner, async (q) => (await q("select public.create_tenant('Temp') as id")).rows[0].id as string, {
      commit: true,
    });
    await db.admin.query("delete from public.tenants where id = $1", [t]);
    expect((await auditFor(t, "tenants")).length).toBeGreaterThan(1);
  });
});

describe("Approver permission (CLAUDE.md rule 3)", () => {
  it("an admin can grant Approver through the UI", async () => {
    const affected = await db.asUser(
      f.alice,
      async (q) => (await q("update public.tenant_members set is_approver = true where user_id = $1", [f.carol])).rowCount,
      { via: "UI", commit: true },
    );
    expect(affected).toBe(1);
    const rows = await auditFor(f.tenantA, "tenant_members", "is_approver");
    expect(rows.at(-1)).toMatchObject({ actor_id: f.alice, via: "UI", old: false, new: true });
  });

  it("Claude cannot grant Approver, even acting as an admin", async () => {
    const erin = await createUser(db, "erin2@example.test");
    const frank = await createUser(db, "frank@example.test");
    await db.asUser(
      f.alice,
      (q) => q("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'creator')", [f.tenantA, frank]),
      { via: "UI", commit: true },
    );
    const asClaude = (sql: string, params: unknown[]) =>
      db.asUser(f.alice, (q) => q(sql, params), { via: "Claude MCP" });
    // promote an existing member
    expect(
      await errorCode(asClaude("update public.tenant_members set is_approver = true where user_id = $1", [frank])),
    ).toBe("P0001");
    // add a new member as approver
    expect(
      await errorCode(
        asClaude(
          "insert into public.tenant_members (tenant_id, user_id, role, is_approver) values ($1, $2, 'creator', true)",
          [f.tenantA, erin],
        ),
      ),
    ).toBe("P0001");
  });

  it("a service account can never be an approver", async () => {
    const bot = await createUser(db, "bot@example.test");
    const code = await errorCode(
      db.admin.query(
        "insert into public.tenant_members (tenant_id, user_id, role, is_service_account, is_approver) values ($1, $2, 'creator', true, true)",
        [f.tenantA, bot],
      ),
    );
    expect(code).toBe("23514");
  });
});
