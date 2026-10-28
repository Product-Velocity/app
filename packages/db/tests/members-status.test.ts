import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #216: member statuses, domain-gated access requests and the unified members grid. Two tenants everywhere (rule 1).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  await db.admin.query("update public.tenants set allowed_email_domains = array['acme.test'] where id = $1", [f.tenantA]);
  await db.admin.query("update public.tenants set allowed_email_domains = array['other.test'] where id = $1", [f.tenantB]);
});
afterAll(async () => {
  await db.close();
});

const count = (u: string, sql: string, params: unknown[] = []) =>
  db.asUser(u, async (q) => Number((await q(sql, params)).rows[0].n));

async function requester(email: string, opts: { confirmed?: boolean } = {}) {
  const id = await createUser(db, email, opts);
  const rows = await db.asUser(id, async (q) => (await q("select * from public.request_access_by_domain()")).rows, { commit: true });
  return { id, rows };
}

describe("request_access_by_domain", () => {
  it("a confirmed email at an authorized domain gets a Requested Access row and no access", async () => {
    const { id, rows } = await requester("newbie@acme.test");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: f.tenantA, created: true });
    const m = (await db.admin.query("select role, status, is_approver from public.tenant_members where user_id = $1", [id])).rows[0];
    expect(m).toEqual({ role: "viewer", status: "requested", is_approver: false });
    // no access to workspace data, the roster, the tenant row or the directory
    expect(await count(id, "select count(*) n from public.projects")).toBe(0);
    expect(await count(id, "select count(*) n from public.tenants")).toBe(0);
    expect(await count(id, "select count(*) n from public.tenant_members")).toBe(0);
    expect(await count(id, "select count(*) n from public.tenant_directory($1)", [f.tenantA])).toBe(0);
    expect(await errorCode(db.asUser(id, (q) => q("insert into public.projects (tenant_id, name) values ($1, 'X')", [f.tenantA])))).toBe("42501");
  });

  it("is idempotent: the second call reports the same request as not new", async () => {
    const id = await createUser(db, "twice@acme.test");
    const first = await db.asUser(id, async (q) => (await q("select * from public.request_access_by_domain()")).rows, { commit: true });
    const second = await db.asUser(id, async (q) => (await q("select * from public.request_access_by_domain()")).rows, { commit: true });
    expect(first[0].created).toBe(true);
    expect(second[0]).toMatchObject({ tenant_id: f.tenantA, created: false });
    expect((await db.admin.query("select 1 from public.tenant_members where user_id = $1", [id])).rowCount).toBe(1);
  });

  it("does nothing for an unconfirmed email, a different domain, or a lookalike", async () => {
    expect((await requester("unconfirmed@acme.test", { confirmed: false })).rows).toHaveLength(0);
    expect((await requester("someone@elsewhere.test")).rows).toHaveLength(0);
    expect((await requester("someone@acme.test.evil.test")).rows).toHaveLength(0);
    expect((await requester("someone@sub.acme.test")).rows).toHaveLength(0);
  });

  it("only the matching workspace is asked (tenant B is untouched)", async () => {
    const { id } = await requester("cross@other.test");
    const rows = (await db.admin.query("select tenant_id from public.tenant_members where user_id = $1", [id])).rows;
    expect(rows).toEqual([{ tenant_id: f.tenantB }]);
  });

  it("does not reopen a revoked or paused person", async () => {
    const id = await createUser(db, "gone@acme.test");
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role, status) values ($1, $2, 'creator', 'revoked')", [f.tenantA, id]);
    const rows = await db.asUser(id, async (q) => (await q("select * from public.request_access_by_domain()")).rows, { commit: true });
    expect(rows).toHaveLength(0);
    expect((await db.admin.query("select status from public.tenant_members where user_id = $1", [id])).rows[0].status).toBe("revoked");
  });

  it("is audited with the system source", async () => {
    const { id } = await requester("audited@acme.test");
    const { rows } = await db.admin.query("select via, actor_id from public.audit_log where entity = 'tenant_members' and field = 'status' and new = '\"requested\"' and actor_id = $1", [id]);
    expect(rows[0]).toMatchObject({ via: "system" });
  });
});

describe("non-active members have no access", () => {
  for (const status of ["paused", "revoked", "requested"]) {
    it(`${status}: sees nothing, writes nothing, and learns their state from my_access_requests`, async () => {
      const id = await createUser(db, `${status}@acme.test`);
      await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role, status) values ($1, $2, 'admin', $3)", [f.tenantA, id, status]);
      expect(await count(id, "select count(*) n from public.projects")).toBe(0);
      expect(await count(id, "select count(*) n from public.items")).toBe(0);
      expect(await count(id, "select count(*) n from public.audit_log")).toBe(0);
      expect(await count(id, "select count(*) n from public.invitations")).toBe(0);
      expect(await errorCode(db.asUser(id, (q) => q("update public.tenants set name = 'Mine' where id = $1", [f.tenantA])))).toBeNull(); // RLS filters to 0 rows
      expect((await db.admin.query("select name from public.tenants where id = $1", [f.tenantA])).rows[0].name).toBe("Tenant A");
      expect(await db.asUser(id, async (q) => (await q("update public.tenant_members set role = 'viewer' where tenant_id = $1", [f.tenantA])).rowCount)).toBe(0);
      expect(await errorCode(db.asUser(id, (q) => q("select * from public.members_grid($1)", [f.tenantA])))).toBe("42501");
      const mine = await db.asUser(id, async (q) => (await q("select tenant_id, tenant_name, status from public.my_access_requests()")).rows);
      expect(mine).toEqual([{ tenant_id: f.tenantA, tenant_name: "Tenant A", status }]);
    });
  }

  it("the tenant roster and directory show only active people to members", async () => {
    const roster = await db.asUser(f.carol, async (q) => (await q("select status from public.tenant_members where tenant_id = $1", [f.tenantA])).rows);
    expect(roster.every((r: { status: string }) => r.status === "active")).toBe(true);
    const dir = await db.asUser(f.carol, async (q) => (await q("select email from public.tenant_directory($1)", [f.tenantA])).rows.map((r: { email: string }) => r.email));
    expect(dir).not.toContain("paused@acme.test");
  });

  it("an admin of the other workspace sees none of this", async () => {
    expect(await count(f.bob, "select count(*) n from public.tenant_members where tenant_id = $1", [f.tenantA])).toBe(0);
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.members_grid($1)", [f.tenantA])))).toBe("42501");
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.set_member_status(array[gen_random_uuid()], 'active')")))).toBeNull();
  });
});

describe("members_grid", () => {
  it("lists every status and the pending invitations for admins, with login and create dates", async () => {
    await db.admin.query("update auth.users set raw_user_meta_data = '{\"full_name\":\"Carol C\"}' where id = $1", [f.carol]);
    await db.admin.query("update public.tenant_members set last_login_at = '2026-10-01T10:00:00Z' where user_id = $1 and tenant_id = $2", [f.carol, f.tenantA]); // per membership (migration 0050)
    const rows = await db.asUser(f.alice, async (q) => (await q("select * from public.members_grid($1)", [f.tenantA])).rows);
    const statuses = new Set(rows.map((r: { status: string }) => r.status));
    expect([...statuses].sort()).toEqual(["active", "invited", "paused", "requested", "revoked"]);
    const carol = rows.find((r: { user_id: string }) => r.user_id === f.carol);
    expect(carol).toMatchObject({ email: "carol@example.test", name: "Carol C", role: "viewer", status: "active" });
    expect(new Date(carol.last_login_at).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(carol.created_at).toBeTruthy();
    const invite = rows.find((r: { status: string }) => r.status === "invited");
    expect(invite).toMatchObject({ email: "pending-a@example.test", role: "creator" });
    expect(rows.some((r: { email: string }) => r.email === "bob@example.test" || r.email === "pending-b@example.test")).toBe(false);
  });
  it("is refused to a non-admin member", async () => {
    expect(await errorCode(db.asUser(f.carol, (q) => q("select * from public.members_grid($1)", [f.tenantA])))).toBe("42501");
  });
});

describe("set_member_status (batch)", () => {
  it("approves four requests at once; they become active and can read the workspace", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 4; i++) ids.push((await requester(`batch${i}@acme.test`)).id);
    const memberIds = (await db.admin.query("select id from public.tenant_members where user_id = any($1)", [ids])).rows.map((r: { id: string }) => r.id);
    const out = await db.asUser(f.alice, async (q) => (await q("select * from public.set_member_status($1, 'active')", [memberIds])).rows, { commit: true });
    expect(out).toHaveLength(4);
    expect(out.every((r: { ok: boolean; previous_status: string }) => r.ok && r.previous_status === "requested")).toBe(true);
    expect(out.map((r: { email: string }) => r.email).sort()).toEqual([1, 2, 3, 4].map((i) => `batch${i}@acme.test`));
    for (const id of ids) {
      expect(await count(id, "select count(*) n from public.projects")).toBeGreaterThan(0);
      expect(await count(id, "select count(*) n from public.tenants")).toBe(1);
    }
    const audit = await db.admin.query("select actor_id, via from public.audit_log where entity = 'tenant_members' and field = 'status' and new = '\"active\"' and actor_id = $1", [f.alice]);
    expect(audit.rowCount).toBeGreaterThanOrEqual(4);
  });

  it("pausing takes access away at once and activating gives it back", async () => {
    const { id } = await requester("flip@acme.test");
    const mid = (await db.admin.query("select id from public.tenant_members where user_id = $1", [id])).rows[0].id;
    await db.asUser(f.alice, (q) => q("select * from public.set_member_status(array[$1::uuid], 'active')", [mid]), { commit: true });
    expect(await count(id, "select count(*) n from public.projects")).toBeGreaterThan(0);
    await db.asUser(f.alice, (q) => q("select * from public.set_member_status(array[$1::uuid], 'paused')", [mid]), { commit: true });
    expect(await count(id, "select count(*) n from public.projects")).toBe(0);
    await db.asUser(f.alice, (q) => q("select * from public.set_member_status(array[$1::uuid], 'revoked')", [mid]), { commit: true });
    expect(await count(id, "select count(*) n from public.projects")).toBe(0);
    await db.asUser(f.alice, (q) => q("select * from public.set_member_status(array[$1::uuid], 'active')", [mid]), { commit: true });
    expect(await count(id, "select count(*) n from public.projects")).toBeGreaterThan(0);
  });

  it("reports a reason per row and still applies the allowed ones", async () => {
    const a = await requester("mix-a@acme.test");
    const b = await requester("mix-b@acme.test");
    const ma = (await db.admin.query("select id from public.tenant_members where user_id = $1", [a.id])).rows[0].id;
    const mb = (await db.admin.query("select id from public.tenant_members where user_id = $1", [b.id])).rows[0].id;
    await db.asUser(f.alice, (q) => q("select * from public.set_member_status(array[$1::uuid], 'active')", [ma]), { commit: true });
    // requested -> paused is not allowed; active -> paused is
    const out: { email: string; ok: boolean; reason: string }[] = await db.asUser(f.alice, async (q) => (await q("select * from public.set_member_status(array[$1::uuid, $2::uuid], 'paused')", [ma, mb])).rows, { commit: true });
    const byEmail = Object.fromEntries(out.map((r) => [r.email, r]));
    expect(byEmail["mix-a@acme.test"].ok).toBe(true);
    expect(byEmail["mix-b@acme.test"]).toMatchObject({ ok: false });
    expect(byEmail["mix-b@acme.test"].reason).toMatch(/cannot become paused/);
    expect((await db.admin.query("select status from public.tenant_members where id = $1", [mb])).rows[0].status).toBe("requested");
  });

  it("refuses your own row, other workspaces, non-admins, service accounts and bad statuses", async () => {
    const aliceRow = (await db.admin.query("select id from public.tenant_members where user_id = $1 and tenant_id = $2", [f.alice, f.tenantA])).rows[0].id;
    const own = await db.asUser(f.alice, async (q) => (await q("select * from public.set_member_status(array[$1::uuid], 'paused')", [aliceRow])).rows);
    expect(own[0]).toMatchObject({ ok: false, reason: "You cannot change your own status." });
    const carolRow = (await db.admin.query("select id from public.tenant_members where user_id = $1 and tenant_id = $2", [f.carol, f.tenantA])).rows[0].id;
    // bob (admin of B) and carol (viewer of A) cannot touch A's rows
    for (const who of [f.bob, f.carol]) {
      const r = await db.asUser(who, async (q) => (await q("select * from public.set_member_status(array[$1::uuid], 'paused')", [carolRow])).rows, { commit: true });
      expect(r[0]).toMatchObject({ ok: false, reason: "Not found." });
    }
    expect((await db.admin.query("select status from public.tenant_members where id = $1", [carolRow])).rows[0].status).toBe("active");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.set_member_status(array[$1::uuid], 'requested')", [carolRow])))).toBe("22023");
    expect(await errorCode(db.asAnon((q) => q("select * from public.set_member_status(array[$1::uuid], 'active')", [carolRow])))).toBe("42501");
  });

  it("status cannot be written through the table, not even by an admin", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.tenant_members set status = 'paused' where user_id = $1", [f.carol])))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.tenant_members (tenant_id, user_id, role, status) values ($1, gen_random_uuid(), 'viewer', 'active')", [f.tenantA])))).toBe("42501");
  });

  it("the last active admin cannot be paused, revoked or demoted, even directly", async () => {
    const owner = await createUser(db, "owner@solo.test");
    const t = await db.asUser(owner, async (q) => (await q("select public.create_tenant('Solo') as id")).rows[0].id as string, { commit: true });
    expect(await errorCode(db.admin.query("update public.tenant_members set status = 'paused' where tenant_id = $1", [t]))).toBe("PV003");
    expect(await errorCode(db.admin.query("update public.tenant_members set status = 'revoked' where tenant_id = $1", [t]))).toBe("PV003");
    // with a second admin, one can be paused; a paused admin does not count as an admin
    const second = await createUser(db, "second@solo.test");
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [t, second]);
    await db.admin.query("update public.tenant_members set status = 'paused' where user_id = $1", [second]);
    expect(await errorCode(db.admin.query("update public.tenant_members set role = 'creator' where user_id = $1", [owner]))).toBe("PV003");
  });
});

describe("accept_invitation with a status", () => {
  it("reactivates a revoked or requested person with the invited role", async () => {
    const id = await createUser(db, "back@acme.test");
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role, status) values ($1, $2, 'viewer', 'revoked')", [f.tenantA, id]);
    await db.asUser(f.alice, (q) => q("insert into public.invitations (tenant_id, email, role, is_approver, token_hash) values ($1, 'back@acme.test', 'creator', false, encode(sha256(convert_to('tok-back', 'utf8')), 'hex'))", [f.tenantA]), { commit: true });
    const t = await db.asUser(id, async (q) => (await q("select public.accept_invitation('tok-back') as t")).rows[0].t, { commit: true });
    expect(t).toBe(f.tenantA);
    expect((await db.admin.query("select role, status from public.tenant_members where user_id = $1", [id])).rows[0]).toEqual({ role: "creator", status: "active" });
  });
  it("still refuses someone who is already active", async () => {
    await db.asUser(f.alice, (q) => q("insert into public.invitations (tenant_id, email, role, is_approver, token_hash) values ($1, 'carol@example.test', 'creator', false, encode(sha256(convert_to('tok-carol', 'utf8')), 'hex'))", [f.tenantA]), { commit: true });
    expect(await errorCode(db.asUser(f.carol, (q) => q("select public.accept_invitation('tok-carol')")))).toBe("PV002");
  });
});

describe("authorized domains and workspace profile", () => {
  const set = (who: string, tenant: string, domains: string[]) =>
    db.asUser(who, (q) => q("update public.tenants set allowed_email_domains = $2 where id = $1", [tenant, domains]));

  it("an admin sets domains; a member and another workspace's admin cannot", async () => {
    await db.asUser(f.alice, (q) => q("update public.tenants set allowed_email_domains = array['acme.test','acme.example'], country = 'Spain', currency = 'EUR', time_zone = 'Europe/Madrid' where id = $1", [f.tenantA]), { commit: true });
    expect((await db.admin.query("select allowed_email_domains, country, currency, time_zone from public.tenants where id = $1", [f.tenantA])).rows[0]).toEqual({ allowed_email_domains: ["acme.test", "acme.example"], country: "Spain", currency: "EUR", time_zone: "Europe/Madrid" });
    expect(await db.asUser(f.carol, async (q) => (await q("update public.tenants set allowed_email_domains = array['evil.test'] where id = $1", [f.tenantA])).rowCount)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.tenants set allowed_email_domains = array['evil.test'] where id = $1", [f.tenantA])).rowCount)).toBe(0);
  });
  it("the audit log records the change", async () => {
    const { rows } = await db.admin.query("select 1 from public.audit_log where entity = 'tenants' and field = 'allowed_email_domains' and entity_id = $1", [f.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
  });
  it("refuses free-mail providers, malformed, upper-case and duplicate domains", async () => {
    expect(await errorCode(set(f.alice, f.tenantA, ["gmail.com"]))).toBe("PV011");
    expect(await errorCode(set(f.alice, f.tenantA, ["Acme.test"]))).toBe("PV010");
    expect(await errorCode(set(f.alice, f.tenantA, ["acme"]))).toBe("PV010");
    expect(await errorCode(set(f.alice, f.tenantA, ["a b.com"]))).toBe("PV010");
    expect(await errorCode(set(f.alice, f.tenantA, ["acme.test", "acme.test"]))).toBe("PV010");
    expect(await errorCode(set(f.alice, f.tenantA, Array.from({ length: 21 }, (_, i) => `d${i}.test`)))).toBe("PV010");
  });
  it("create_tenant with a profile makes the caller the Account Admin", async () => {
    const owner = await createUser(db, "founder@newco.test");
    const t = await db.asUser(owner, async (q) => (await q("select public.create_tenant('NewCo', 'Germany', 'EUR', 'Europe/Berlin', array['newco.test']) as id")).rows[0].id as string, { commit: true });
    expect((await db.admin.query("select role, status from public.tenant_members where tenant_id = $1 and user_id = $2", [t, owner])).rows[0]).toEqual({ role: "admin", status: "active" });
    expect((await db.admin.query("select country, currency, time_zone, allowed_email_domains from public.tenants where id = $1", [t])).rows[0]).toEqual({ country: "Germany", currency: "EUR", time_zone: "Europe/Berlin", allowed_email_domains: ["newco.test"] });
    const colleague = await createUser(db, "pat@newco.test");
    const rows = await db.asUser(colleague, async (q) => (await q("select * from public.request_access_by_domain()")).rows, { commit: true });
    expect(rows[0]).toMatchObject({ tenant_id: t, created: true });
  });
  it("create_tenant refuses a free-mail domain", async () => {
    const owner = await createUser(db, "x@newco2.test");
    expect(await errorCode(db.asUser(owner, (q) => q("select public.create_tenant('X', null, null, null, array['yahoo.com'])")))).toBe("PV011");
  });
});

describe("admin emails", () => {
  it("only the service role can list a workspace's admin emails", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.tenant_admin_emails($1)", [f.tenantA])))).toBe("42501");
    const rows = await db.asService(async (q) => (await q("select * from public.tenant_admin_emails($1)", [f.tenantA])).rows);
    expect(rows.map((r: { tenant_admin_emails: string }) => r.tenant_admin_emails)).toEqual(["alice@example.test"]);
  });
});
