import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #673: a confirmed email at an authorized domain joins as an active Viewer (per-workspace switch, default on). Two tenants (rule 1).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const rpc = <T,>(user: string, sql: string, params: unknown[] = []) => db.asUser(user, async (q) => (await q(sql, params)).rows as T[], { commit: true });
const join = (user: string) => rpc<{ tenant_id: string; created: boolean; joined: boolean }>(user, "select * from public.request_access_by_domain()");
const member = async (tenant: string, user: string) =>
  (await db.admin.query("select status, role, is_approver, requested_via_email from public.tenant_members where tenant_id = $1 and user_id = $2", [tenant, user])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  await db.admin.query("update public.tenants set allowed_email_domains = array['acme.test'] where id = $1", [f.tenantA]);
  await db.admin.query("update public.tenants set allowed_email_domains = array['beta.test'], auto_join_authorized_domains = false where id = $1", [f.tenantB]);
});
afterAll(async () => { await db.close(); });

describe("domain auto-join", () => {
  it("is on by default, and a confirmed address joins as an active Viewer with access to its own workspace only", async () => {
    expect((await db.admin.query("select auto_join_authorized_domains a from public.tenants where id = $1", [f.tenantA])).rows[0].a).toBe(true);
    const id = await createUser(db, "new@acme.test");
    const rows = await join(id);
    expect(rows).toEqual([{ tenant_id: f.tenantA, tenant_name: expect.any(String), created: true, joined: true }]);
    expect(await member(f.tenantA, id)).toEqual({ status: "active", role: "viewer", is_approver: false, requested_via_email: null });
    expect(await db.asUser(id, async (q) => (await q("select id from public.tenants")).rows.map((r) => r.id))).toEqual([f.tenantA]);
    expect(await errorCode(db.asUser(id, (q) => q("insert into public.projects (tenant_id, name) values ($1, 'X')", [f.tenantA])))).toBe("42501");
    expect(await member(f.tenantB, id)).toBeUndefined();
    const audit = await db.admin.query("select via from public.audit_log where entity = 'tenant_members' and field = 'status' and new = '\"active\"' and actor_id = $1", [id]);
    expect(audit.rows[0]?.via).toBe("system");
  });

  it("a second call does not join or notify again", async () => {
    const id = await createUser(db, "twice@acme.test");
    await join(id);
    expect(await join(id)).toEqual([]);
  });

  it("an unconfirmed address gets nothing", async () => {
    const id = await createUser(db, "unconfirmed@acme.test", { confirmed: false });
    expect(await join(id)).toEqual([]);
    expect(await member(f.tenantA, id)).toBeUndefined();
  });

  it("a workspace with the switch off still creates Requested Access, which grants nothing", async () => {
    const id = await createUser(db, "waiting@beta.test");
    expect(await join(id)).toEqual([{ tenant_id: f.tenantB, tenant_name: expect.any(String), created: true, joined: false }]);
    expect((await member(f.tenantB, id)).status).toBe("requested");
    expect(await db.asUser(id, async (q) => Number((await q("select count(*) n from public.tenants")).rows[0].n))).toBe(0);
  });

  it("paused and revoked people are not let back in by signing up again", async () => {
    for (const status of ["paused", "revoked"]) {
      const id = await createUser(db, `${status}@acme.test`);
      await join(id);
      await db.admin.query("update public.tenant_members set status = $3 where tenant_id = $1 and user_id = $2", [f.tenantA, id, status]);
      expect(await join(id)).toEqual([]);
      expect((await member(f.tenantA, id)).status).toBe(status);
    }
  });

  it("verifying a linked address at the domain joins as Viewer and remembers the address; removing it sends the person back to review", async () => {
    const id = await createUser(db, "home@elsewhere.test");
    await rpc(id, "select * from public.link_email_start($1, $2)", ["work@acme.test", sha("123456")]);
    const out = await rpc<{ ok: boolean; tenant_id: string; created: boolean; joined: boolean }>(id, "select * from public.link_email_verify($1, $2)", ["work@acme.test", "123456"]);
    expect(out).toEqual([{ ok: true, tenant_id: f.tenantA, tenant_name: expect.any(String), created: true, joined: true }]);
    expect(await member(f.tenantA, id)).toMatchObject({ status: "active", role: "viewer", requested_via_email: "work@acme.test" });
    await rpc(id, "select public.remove_linked_email($1)", ["work@acme.test"]);
    expect((await member(f.tenantA, id)).status).toBe("requested");
  });

  it("only an admin of the workspace can switch it", async () => {
    await db.asUser(f.carol, (q) => q("update public.tenants set auto_join_authorized_domains = false where id = $1", [f.tenantA]), { commit: true }).catch(() => undefined);
    await db.asUser(f.bob, (q) => q("update public.tenants set auto_join_authorized_domains = false where id = $1", [f.tenantA]), { commit: true }).catch(() => undefined);
    expect((await db.admin.query("select auto_join_authorized_domains a from public.tenants where id = $1", [f.tenantA])).rows[0].a).toBe(true);
    await db.asUser(f.alice, (q) => q("update public.tenants set auto_join_authorized_domains = false where id = $1", [f.tenantA]), { commit: true });
    const id = await createUser(db, "late@acme.test");
    expect((await join(id))[0]).toMatchObject({ created: true, joined: false });
    await db.admin.query("update public.tenants set auto_join_authorized_domains = true where id = $1", [f.tenantA]);
  });
});
