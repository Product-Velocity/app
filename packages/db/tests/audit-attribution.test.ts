import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #219 (R-111) phase 0: audit entries carry the actor's name, email and role as they were at the time; batches share an id;
// last login is per membership; invitations can be restricted to authorized domains. Two tenants everywhere (rule 1).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  await db.admin.query(`update auth.users set raw_user_meta_data = '{"full_name":"Alice Admin"}' where id = $1`, [f.alice]);
});
afterAll(async () => {
  await db.close();
});

const entries = async (tenant: string, entity: string, field: string) =>
  (await db.admin.query("select * from public.audit_log where tenant_id = $1 and entity = $2 and field = $3 order by id", [tenant, entity, field])).rows;

describe("audit attribution (FR-6.2, FR-6.5)", () => {
  it("stores name, email and role of the actor on the entry", async () => {
    await db.asUser(f.alice, (q) => q("update public.tenants set name = 'Tenant A (renamed)' where id = $1", [f.tenantA]), { via: "UI", commit: true });
    const row = (await entries(f.tenantA, "tenants", "name")).at(-1);
    expect(row).toMatchObject({ actor_id: f.alice, actor_name: "Alice Admin", actor_email: "alice@example.test", actor_role: "admin", actor_platform_admin: false, via: "UI" });
  });

  it("keeps the old name and email when the person later changes them (snapshot)", async () => {
    await db.admin.query(`update auth.users set raw_user_meta_data = '{"full_name":"Alice Renamed"}', email = 'alice.new@example.test' where id = $1`, [f.alice]);
    await db.asUser(f.alice, (q) => q("update public.tenants set name = 'Tenant A again' where id = $1", [f.tenantA]), { via: "UI", commit: true });
    const rows = await entries(f.tenantA, "tenants", "name");
    const before = rows.at(-2), after = rows.at(-1);
    expect(before).toMatchObject({ actor_name: "Alice Admin", actor_email: "alice@example.test" });
    expect(after).toMatchObject({ actor_name: "Alice Renamed", actor_email: "alice.new@example.test" });
    await db.admin.query(`update auth.users set raw_user_meta_data = '{"full_name":"Alice Admin"}', email = 'alice@example.test' where id = $1`, [f.alice]);
  });

  it("falls back to the part before the @ when the person has no name, and leaves system entries without a person", async () => {
    await db.asUser(f.bob, (q) => q("update public.tenants set name = 'Tenant B1' where id = $1", [f.tenantB]), { commit: true });
    expect((await entries(f.tenantB, "tenants", "name")).at(-1)).toMatchObject({ actor_name: "bob", actor_email: "bob@example.test" });
    await db.asService((q) => q("update public.tenants set name = 'Tenant B2' where id = $1", [f.tenantB]), { commit: true });
    expect((await entries(f.tenantB, "tenants", "name")).at(-1)).toMatchObject({ actor_id: null, actor_name: null, actor_email: null, via: "system" });
  });

  it("records the role the person had in THAT workspace, and the screen when the app says so", async () => {
    // alice is a viewer in nobody's workspace but admin in A; make her a creator in B to prove roles are per account
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'creator')", [f.tenantB, f.alice]);
    const item = (await db.admin.query("select id, home_project_id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0];
    await db.asUser(f.alice, (q) => q("update public.items set initiative_name = 'Renamed by a creator' where id = $1", [item.id]), { commit: true });
    expect((await entries(f.tenantB, "items", "initiative_name")).at(-1)).toMatchObject({ actor_role: "creator", project_id: item.home_project_id, screen: null });
    await db.asUser(f.alice, async (q) => {
      await q("select set_config('app.screen', 'gantt', true)");
      await q("update public.items set initiative_name = 'Renamed again' where id = $1", [item.id]);
    }, { commit: true });
    expect((await entries(f.tenantB, "items", "initiative_name")).at(-1)).toMatchObject({ screen: "gantt", old: "Renamed by a creator", new: "Renamed again" });
  });

  it("takes the screen from the request header, but only a short plain label", async () => {
    const item = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
    await db.asUser(f.alice, (q) => q("update public.items set initiative_name = 'via header' where id = $1", [item]), { commit: true, headers: { "x-pv-screen": "cards" } });
    expect((await entries(f.tenantA, "items", "initiative_name")).at(-1).screen).toBe("cards");
    await db.asUser(f.alice, (q) => q("update public.items set initiative_name = 'via header 2' where id = $1", [item]), { commit: true, headers: { "x-pv-screen": "<script>alert(1)</script>" } });
    expect((await entries(f.tenantA, "items", "initiative_name")).at(-1).screen).toBeNull();
  });

  it("cannot be forged or changed by a client (append-only, no insert grant)", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.audit_log set actor_name = 'x' where tenant_id = $1", [f.tenantA])))).toBeTruthy();
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.audit_log (tenant_id, entity, field, via, actor_name) values ($1, 'tenants', 'name', 'UI', 'x')", [f.tenantA])))).toBe("42501");
  });

  it("a workspace admin sees only their own workspace's entries", async () => {
    const mine = await db.asUser(f.alice, async (q) => (await q("select distinct tenant_id from public.audit_log")).rows.map((r) => r.tenant_id));
    expect(mine).toEqual([f.tenantA]);
  });
});

describe("batch actions (FR-6.8)", () => {
  it("approving 4 requested members writes 4 entries with one batch id and the approver's name and email", async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      const u = await createUser(db, `req${n}@example.test`);
      const r = await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role, status) values ($1, $2, 'viewer', 'requested') returning id", [f.tenantA, u]);
      ids.push(r.rows[0].id);
    }
    const res = await db.asUser(f.alice, async (q) => (await q("select * from public.set_member_status($1::uuid[], 'active')", [ids])).rows, { via: "UI", commit: true });
    expect(res.every((r) => r.ok)).toBe(true);
    const rows = (await entries(f.tenantA, "tenant_members", "status")).filter((r) => ids.includes(r.entity_id) && r.new === "active");
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
    expect(rows[0].batch_id).not.toBeNull();
    for (const r of rows) expect(r).toMatchObject({ actor_name: "Alice Admin", actor_email: "alice@example.test", old: "requested", new: "active" });
  });

  it("a separate batch gets a different id, and single edits outside a batch have none", async () => {
    const u = await createUser(db, "solo@example.test");
    const m = (await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role, status) values ($1, $2, 'viewer', 'requested') returning id", [f.tenantA, u])).rows[0].id;
    await db.asUser(f.alice, (q) => q("select * from public.set_member_status($1::uuid[], 'active')", [[m]]), { commit: true });
    const last = (await entries(f.tenantA, "tenant_members", "status")).at(-1);
    const first = (await entries(f.tenantA, "tenant_members", "status")).find((r) => r.new === "active" && r.entity_id !== m);
    expect(last.batch_id).not.toBe(first.batch_id);
    await db.asUser(f.alice, (q) => q("update public.tenant_members set role = 'creator' where id = $1", [m]), { commit: true });
    expect((await entries(f.tenantA, "tenant_members", "role")).at(-1).batch_id).toBeNull();
  });
});

describe("last login per membership", () => {
  it("is set for the workspace that was opened, not for the person's other memberships, and is not audited", async () => {
    const before = (await db.admin.query("select count(*)::int n from public.audit_log")).rows[0].n;
    await db.asUser(f.alice, (q) => q("select public.touch_membership_login($1)", [f.tenantA]), { commit: true });
    const rows = (await db.admin.query("select tenant_id, last_login_at from public.tenant_members where user_id = $1", [f.alice])).rows;
    expect(rows.find((r) => r.tenant_id === f.tenantA).last_login_at).not.toBeNull();
    expect(rows.find((r) => r.tenant_id === f.tenantB).last_login_at).toBeNull();
    expect((await db.admin.query("select count(*)::int n from public.audit_log")).rows[0].n).toBe(before);
  });

  it("cannot touch another person's membership or a workspace the caller is not in", async () => {
    await db.asUser(f.dave, (q) => q("select public.touch_membership_login($1)", [f.tenantA]), { commit: true });
    const carol = (await db.admin.query("select last_login_at from public.tenant_members where user_id = $1 and tenant_id = $2", [f.carol, f.tenantA])).rows[0];
    expect(carol.last_login_at).toBeNull();
  });

  it("members_grid shows the per-membership value", async () => {
    const rows = (await db.asUser(f.alice, async (q) => (await q("select * from public.members_grid($1)", [f.tenantA])).rows));
    expect(rows.find((r) => r.user_id === f.alice).last_login_at).not.toBeNull();
    expect(rows.find((r) => r.user_id === f.carol).last_login_at).toBeNull();
  });
});

describe("restrict invites to authorized domains (section 4.4)", () => {
  const invite = (user: string, tenant: string, email: string) =>
    db.asUser(user, (q) => q("insert into public.invitations (tenant_id, email, role, token_hash) values ($1, $2, 'viewer', $3)", [tenant, email, `t-${email}`]));

  it("is off by default: an off-domain consultant can be invited", async () => {
    await db.admin.query("update public.tenants set allowed_email_domains = array['acme.test'] where id = $1", [f.tenantA]);
    await expect(invite(f.alice, f.tenantA, "consultant@elsewhere.test")).resolves.toBeDefined();
  });

  it("when on, blocks off-domain invitations and allows on-domain ones", async () => {
    await db.asUser(f.alice, (q) => q("update public.tenants set restrict_invites_to_domains = true where id = $1", [f.tenantA]), { commit: true });
    expect(await errorCode(invite(f.alice, f.tenantA, "other@elsewhere.test"))).toBe("PV012");
    await expect(invite(f.alice, f.tenantA, "colleague@acme.test")).resolves.toBeDefined();
  });

  it("is per workspace and only admins can change it", async () => {
    await expect(invite(f.bob, f.tenantB, "someone@elsewhere.test")).resolves.toBeDefined();
    await db.asUser(f.carol, (q) => q("update public.tenants set restrict_invites_to_domains = false where id = $1", [f.tenantA]), { commit: true }).catch(() => undefined);
    const still = (await db.admin.query("select restrict_invites_to_domains r from public.tenants where id = $1", [f.tenantA])).rows[0].r;
    expect(still).toBe(true);
  });
});
