import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, inviteRow, twoTenantFixture, type TestDb } from "./helpers";

// Issue #219 (R-111) phases 2 and 3: one identity with several memberships, linked verified emails. Two tenants everywhere (rule 1).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const rpc = <T,>(user: string, sql: string, params: unknown[] = [], commit = true) => db.asUser(user, async (q) => (await q(sql, params)).rows as T[], { commit });
const start = (user: string, email: string, code = "123456") => rpc<{ send: boolean }>(user, "select * from public.link_email_start($1, $2)", [email, sha(code)]);
const verify = (user: string, email: string, code = "123456") =>
  rpc<{ ok: boolean; tenant_id: string | null; tenant_name: string | null; created: boolean }>(user, "select * from public.link_email_verify($1, $2)", [email, code]);
const member = async (tenant: string, user: string) =>
  (await db.admin.query("select status, role, requested_via_email from public.tenant_members where tenant_id = $1 and user_id = $2", [tenant, user])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  await db.admin.query("update public.tenants set allowed_email_domains = array['acme.test'] where id = $1", [f.tenantA]);
  await db.admin.query("update public.tenants set allowed_email_domains = array['beta.test'] where id = $1", [f.tenantB]);
});
afterAll(async () => {
  await db.close();
});

describe("single login for several accounts (acceptance 8, FR-3)", () => {
  it("a consultant invited by two companies accepts both and sees both after one login", async () => {
    const eve = await createUser(db, "eve@freelance.test");
    for (const [admin, tenant, token] of [[f.alice, f.tenantA, "tok-a"], [f.bob, f.tenantB, "tok-b"]] as const) {
      await db.asUser(admin, (q) => inviteRow(q, tenant, "eve@freelance.test", "creator", token), { commit: true });
    }
    await rpc(eve, "select public.accept_invitation($1)", ["tok-a"]);
    await rpc(eve, "select public.accept_invitation($1)", ["tok-b"]);
    const ids = await db.asUser(eve, async (q) => (await q("select id from public.tenants order by name")).rows.map((r) => r.id));
    expect(ids.sort()).toEqual([f.tenantA, f.tenantB].sort());
    expect((await db.admin.query("select count(*)::int n from auth.users where email = 'eve@freelance.test'")).rows[0].n).toBe(1);
    // roles are per account (FR-3.3)
    await db.admin.query("update public.tenant_members set role = 'viewer' where tenant_id = $1 and user_id = $2", [f.tenantB, eve]);
    expect((await member(f.tenantA, eve)).role).toBe("creator");
    expect((await member(f.tenantB, eve)).role).toBe("viewer");
  });

  it("revoking in one account leaves the other untouched (acceptance 10)", async () => {
    const eve = (await db.admin.query("select id from auth.users where email = 'eve@freelance.test'")).rows[0].id;
    const mid = (await db.admin.query("select id from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantB, eve])).rows[0].id;
    const res = await rpc<{ ok: boolean }>(f.bob, "select * from public.set_member_status(array[$1]::uuid[], 'revoked')", [mid]);
    expect(res[0].ok).toBe(true);
    const visible = await db.asUser(eve, async (q) => (await q("select id from public.tenants")).rows.map((r) => r.id));
    expect(visible).toEqual([f.tenantA]);
    expect(await rpc(eve, "select count(*)::int n from public.projects"), "still reads A's data").toEqual([{ n: 1 }]);
  });

  it("a user with no membership cannot open another account (acceptance 12)", async () => {
    const stranger = await createUser(db, "stranger@nowhere.test");
    await db.asUser(stranger, async (q) => {
      expect((await q("select 1 from public.tenants")).rows).toHaveLength(0);
      expect((await q("select 1 from public.projects")).rows).toHaveLength(0);
      expect((await q("select 1 from public.items")).rows).toHaveLength(0);
    });
    expect(await errorCode(db.asUser(stranger, (q) => q("select * from public.members_grid($1)", [f.tenantA])))).toBe("42501");
  });
});

describe("linking and verifying an email (FR-4.1)", () => {
  it("an unverified address counts for nothing; the right code verifies it", async () => {
    const mia = await createUser(db, "mia@home.test");
    expect((await start(mia, "mia@acme.test"))[0].send).toBe(true);
    // not yet verified: no Requested Access, not in verified list, not usable for invitations
    expect(await member(f.tenantA, mia)).toBeUndefined();
    expect((await rpc<{ email: string; verified: boolean }>(mia, "select email, verified from public.my_emails()")).map((r) => [r.email, r.verified])).toEqual([["mia@home.test", true], ["mia@acme.test", false]]);
    const bad = await verify(mia, "mia@acme.test", "000000");
    expect(bad).toEqual([{ ok: false, tenant_id: null, tenant_name: null, created: false }]);
    const good = await verify(mia, "mia@acme.test");
    expect(good).toEqual([{ ok: true, tenant_id: f.tenantA, tenant_name: "Tenant A", created: true }]);
  });

  it("domain match on the verified address creates Requested Access that an admin approves in the members grid (acceptance 9)", async () => {
    const mia = (await db.admin.query("select id from auth.users where email = 'mia@home.test'")).rows[0].id;
    expect(await member(f.tenantA, mia)).toEqual({ status: "requested", role: "viewer", requested_via_email: "mia@acme.test" });
    expect(await rpc(mia, "select count(*)::int n from public.projects")).toEqual([{ n: 0 }]); // no access until approved
    const grid = await rpc<{ email: string; status: string }>(f.alice, "select * from public.members_grid($1)", [f.tenantA]);
    expect(grid.find((r) => r.email === "mia@home.test")?.status).toBe("requested");
    const mid = (await db.admin.query("select id from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, mia])).rows[0].id;
    await rpc(f.alice, "select * from public.set_member_status(array[$1]::uuid[], 'active')", [mid]);
    expect((await rpc<{ n: number }>(mia, "select count(*)::int n from public.projects"))[0].n).toBeGreaterThan(0);
    // and only Company A: B (beta.test) is unaffected
    expect(await member(f.tenantB, mia)).toBeUndefined();
  });

  it("request_access_by_domain also looks at verified linked emails, and returns each workspace once", async () => {
    const ned = await createUser(db, "ned@acme.test");
    await start(ned, "ned2@acme.test"); await verify(ned, "ned2@acme.test");
    const rows = await rpc<{ tenant_id: string }>(ned, "select * from public.request_access_by_domain()");
    expect(rows.map((r) => r.tenant_id)).toEqual([f.tenantA]);
  });

  it("wrong codes are limited to five tries, and an expired code is refused", async () => {
    const zed = await createUser(db, "zed@home.test");
    await start(zed, "zed@beta.test");
    for (let i = 0; i < 5; i++) expect((await verify(zed, "zed@beta.test", "111111"))[0].ok).toBe(false);
    expect((await verify(zed, "zed@beta.test"))[0].ok).toBe(false); // the right code is no longer accepted
    expect(await member(f.tenantB, zed)).toBeUndefined();
    await db.admin.query("update identity.emails set code_sent_at = now() - interval '2 minutes' where email = 'zed@beta.test'");
    await start(zed, "zed@beta.test", "222222");
    await db.admin.query("update identity.emails set code_expires_at = now() - interval '1 minute' where email = 'zed@beta.test'");
    expect((await verify(zed, "zed@beta.test", "222222"))[0].ok).toBe(false);
  });

  it("codes are rate limited, and the database keeps only a hash", async () => {
    const kim = await createUser(db, "kim@home.test");
    await start(kim, "kim@elsewhere.test");
    expect(await errorCode(rpc(kim, "select * from public.link_email_start($1, $2)", ["kim@elsewhere.test", sha("999999")]))).toBe("PV032");
    const stored = (await db.admin.query("select code_hash from identity.emails where email = 'kim@elsewhere.test'")).rows[0].code_hash;
    expect(stored).toBe(sha("123456"));
    expect(stored).not.toContain("123456");
  });

  it("an address belongs to one person (FR-4.5): the second person is told nothing and nothing is stored or sent", async () => {
    const a = await createUser(db, "a@home.test");
    const b = await createUser(db, "b@home.test");
    await start(a, "shared@beta.test"); await verify(a, "shared@beta.test");
    expect((await start(b, "shared@beta.test"))[0].send).toBe(false);          // verified for A
    expect((await start(b, "a@home.test"))[0].send).toBe(false);               // A's sign-in email
    expect((await db.admin.query("select 1 from identity.emails where user_id = $1", [b])).rowCount).toBe(0);
    expect(await errorCode(rpc(a, "select * from public.link_email_start($1, $2)", ["a@home.test", sha("1")]))).toBe("PV031"); // own sign-in email
  });

  it("the table is unreachable from the API; only the owner's functions show the owner's addresses", async () => {
    const a = (await db.admin.query("select id from auth.users where email = 'a@home.test'")).rows[0].id;
    expect(await errorCode(db.asUser(a, (q) => q("select * from identity.emails")))).toBe("42501");
    const b = (await db.admin.query("select id from auth.users where email = 'b@home.test'")).rows[0].id;
    const mine = await rpc<{ email: string }>(b, "select * from public.my_emails()");
    expect(mine.map((r) => r.email)).toEqual(["b@home.test"]);
  });
});

describe("invitations to a linked email (FR-3.2, FR-4.2)", () => {
  it("an invitation sent to a verified linked address is accepted by the same person", async () => {
    const a = (await db.admin.query("select id from auth.users where email = 'a@home.test'")).rows[0].id;
    await db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "shared@beta.test", "creator", "tok-linked"), { commit: true });
    await rpc(a, "select public.accept_invitation($1)", ["tok-linked"]);
    expect(await member(f.tenantA, a)).toMatchObject({ status: "active", role: "creator", requested_via_email: null });
  });

  it("an unverified or foreign address does not work", async () => {
    const b = (await db.admin.query("select id from auth.users where email = 'b@home.test'")).rows[0].id;
    await db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "someone-else@acme.test", "creator", "tok-foreign"), { commit: true });
    expect(await errorCode(rpc(b, "select public.accept_invitation($1)", ["tok-foreign"]))).toBe("PV001");
  });
});

describe("removing a linked email (FR-4.6)", () => {
  it("memberships that came only through the address go back to Requested Access; invitation-based ones stay", async () => {
    const mia = (await db.admin.query("select id from auth.users where email = 'mia@home.test'")).rows[0].id;
    expect((await member(f.tenantA, mia)).status).toBe("active");
    const n = await rpc<{ remove_linked_email: number }>(mia, "select public.remove_linked_email('mia@acme.test')");
    expect(n[0].remove_linked_email).toBe(1);
    expect(await member(f.tenantA, mia)).toMatchObject({ status: "requested", requested_via_email: null });
    expect(await rpc(mia, "select count(*)::int n from public.projects")).toEqual([{ n: 0 }]);

    const a = (await db.admin.query("select id from auth.users where email = 'a@home.test'")).rows[0].id;
    await rpc(a, "select public.remove_linked_email('shared@beta.test')");
    expect((await member(f.tenantA, a)).status).toBe("active"); // came from an invitation
    // the address is free again for another person
    const b = (await db.admin.query("select id from auth.users where email = 'b@home.test'")).rows[0].id;
    expect((await start(b, "shared@beta.test"))[0].send).toBe(true);
  });

  it("you can only remove your own", async () => {
    const b = (await db.admin.query("select id from auth.users where email = 'b@home.test'")).rows[0].id;
    expect(await errorCode(rpc(b, "select public.remove_linked_email('ned2@acme.test')"))).toBe("P0002");
  });
});

describe("notification email (FR-4.4) and sign-in with a linked email (FR-4.2)", () => {
  it("the person picks a verified address; admins are notified at it", async () => {
    const ned = (await db.admin.query("select id from auth.users where email = 'ned@acme.test'")).rows[0].id;
    expect(await errorCode(rpc(ned, "select public.set_notification_email('nope@x.test')"))).toBe("PV034");
    await rpc(ned, "select public.set_notification_email('ned2@acme.test')");
    const mine = await rpc<{ email: string; use_for_notifications: boolean }>(ned, "select * from public.my_emails()");
    expect(mine.find((r) => r.use_for_notifications)?.email).toBe("ned2@acme.test");
    expect((await db.admin.query("select identity.notification_email($1) e", [ned])).rows[0].e).toBe("ned2@acme.test");
    await rpc(ned, "select public.set_notification_email('')");
    expect((await db.admin.query("select identity.notification_email($1) e", [ned])).rows[0].e).toBe("ned@acme.test");
  });

  it("only the server can look up which sign-in email a verified linked address belongs to", async () => {
    const ned = (await db.admin.query("select id from auth.users where email = 'ned@acme.test'")).rows[0].id;
    expect((await db.asService(async (q) => (await q("select public.resolve_sign_in_email('NED2@acme.test') e")).rows[0].e))).toBe("ned@acme.test");
    expect((await db.asService(async (q) => (await q("select public.resolve_sign_in_email('unknown@x.test') e")).rows[0].e))).toBeNull();
    expect(await errorCode(db.asUser(ned, (q) => q("select public.resolve_sign_in_email('ned2@acme.test')")))).toBe("42501");
    expect(await errorCode(db.asAnon((q) => q("select public.resolve_sign_in_email('ned2@acme.test')")))).toBe("42501");
  });
});
