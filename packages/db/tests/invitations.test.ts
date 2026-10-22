import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, hashToken, inviteRow, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

const NOT_VALID = "PV001";
let n = 0;

/** Admin alice invites `email`; returns the plain token. */
async function invite(email: string, role = "creator", isApprover = false, tenant = f.tenantA, admin = f.alice) {
  const token = `tok-${++n}-${Math.random()}`;
  await db.asUser(admin, (q) => inviteRow(q, tenant, email, role, token, isApprover), { commit: true });
  return token;
}
const accept = (userId: string, token: string, opts?: { via?: string; commit?: boolean }) =>
  db.asUser(userId, async (q) => (await q("select public.accept_invitation($1) as t", [token])).rows[0].t as string, {
    commit: true,
    ...opts,
  });

describe("invitations: who can manage them", () => {
  it("only admins of the tenant can create, list and revoke", async () => {
    // carol is a viewer of A
    const code = await errorCode(
      db.asUser(f.carol, (q) => inviteRow(q, f.tenantA, "x@example.test", "viewer", "t-viewer")),
    );
    expect(code).toBe("42501");
    const seen = await db.asUser(f.carol, async (q) => (await q("select * from public.invitations")).rows);
    expect(seen).toHaveLength(0);
    const revoked = await db.asUser(
      f.carol,
      async (q) => (await q("update public.invitations set revoked_at = now()")).rowCount,
      { commit: true },
    );
    expect(revoked).toBe(0);
  });

  it("rejects a bad role, a bad email and a second pending invite for the same email", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "ok@example.test", "owner", "t1")))).toBe("23514");
    expect(await errorCode(db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "Not An Email", "viewer", "t2")))).toBe("23514");
    await invite("dup@example.test");
    expect(await errorCode(db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "dup@example.test", "viewer", "t3")))).toBe("23505");
  });

  it("is audited with actor and source", async () => {
    await db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "audited@example.test", "viewer", "t-audit"), {
      via: "UI",
      commit: true,
    });
    const { rows } = await db.admin.query(
      "select actor_id, via, new from public.audit_log where entity = 'invitations' and field = 'email' and new = '\"audited@example.test\"'::jsonb",
    );
    expect(rows[0]).toMatchObject({ actor_id: f.alice, via: "UI" });
  });

  it("Claude cannot create an Approver invitation (rule 3), but can create a normal one", async () => {
    const asClaude = (approver: boolean, email: string) =>
      db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, email, "creator", `claude-${email}`, approver), { via: "Claude MCP" });
    expect(await errorCode(asClaude(true, "c1@example.test"))).toBe("P0001");
    expect(await errorCode(asClaude(false, "c2@example.test"))).toBeNull();
  });
});

describe("accept_invitation", () => {
  it("creates the membership with the invited role and Approver flag, once", async () => {
    const gina = await createUser(db, "gina@example.test");
    const token = await invite("gina@example.test", "creator", true);
    expect(await accept(gina, token)).toBe(f.tenantA);
    const { rows } = await db.admin.query(
      "select role, is_approver from public.tenant_members where tenant_id = $1 and user_id = $2",
      [f.tenantA, gina],
    );
    expect(rows[0]).toEqual({ role: "creator", is_approver: true });
    // single use
    expect(await errorCode(accept(gina, token))).toBe(NOT_VALID);
  });

  it("matches the email case-insensitively", async () => {
    const hal = await createUser(db, "Hal@Example.test");
    const token = await invite("hal@example.test", "viewer");
    expect(await accept(hal, token)).toBe(f.tenantA);
  });

  it("rejects the wrong user, an unconfirmed email, an unknown token and anonymous callers", async () => {
    const token = await invite("ivy@example.test");
    expect(await errorCode(accept(f.dave, token))).toBe(NOT_VALID); // someone else's invite
    const ivyUnconfirmed = await createUser(db, "ivy@example.test", { confirmed: false });
    expect(await errorCode(accept(ivyUnconfirmed, token))).toBe(NOT_VALID);
    expect(await errorCode(accept(f.dave, "no-such-token"))).toBe(NOT_VALID);
    expect(await errorCode(db.asAnon((q) => q("select public.accept_invitation($1)", [token])))).toBe("42501");
  });

  it("rejects expired and revoked invitations", async () => {
    const jo = await createUser(db, "jo@example.test");
    const expired = await invite("jo@example.test");
    await db.admin.query("update public.invitations set expires_at = now() - interval '1 minute' where token_hash = $1", [hashToken(expired)]);
    expect(await errorCode(accept(jo, expired))).toBe(NOT_VALID);

    const kim = await createUser(db, "kim@example.test");
    const revoked = await invite("kim@example.test");
    await db.asUser(f.alice, (q) => q("update public.invitations set revoked_at = now() where token_hash = $1", [hashToken(revoked)]), { commit: true });
    expect(await errorCode(accept(kim, revoked))).toBe(NOT_VALID);
  });

  it("does not let an existing member change their role through an invitation", async () => {
    const token = await invite("carol@example.test", "admin"); // carol is a viewer of A
    expect(await errorCode(accept(f.carol, token))).toBe("PV002");
    const { rows } = await db.admin.query("select role from public.tenant_members where user_id = $1 and tenant_id = $2", [f.carol, f.tenantA]);
    expect(rows[0].role).toBe("viewer");
  });

  it("an invitation only grants access to its own tenant", async () => {
    const lee = await createUser(db, "lee@example.test");
    const token = await invite("lee@example.test", "viewer", false, f.tenantB, f.bob);
    expect(await accept(lee, token)).toBe(f.tenantB);
    const { rows } = await db.admin.query("select tenant_id from public.tenant_members where user_id = $1", [lee]);
    expect(rows.map((r) => r.tenant_id)).toEqual([f.tenantB]);
  });

  it("records the acceptance in the audit log", async () => {
    const mia = await createUser(db, "mia@example.test");
    const token = await invite("mia@example.test");
    await accept(mia, token, { via: "UI" });
    const { rows } = await db.admin.query(
      "select actor_id, via from public.audit_log where entity = 'invitations' and field = 'accepted_by' and new = to_jsonb($1::text) order by id desc limit 1",
      [mia],
    );
    expect(rows[0]).toMatchObject({ actor_id: mia, via: "UI" });
  });
});

describe("write source from the request header", () => {
  it("falls back to x-pv-via when app.via is not set", async () => {
    await db.asUser(f.alice, (q) => q("update public.tenants set name = 'Header' where id = $1", [f.tenantA]), {
      headers: { "x-pv-via": "UI" },
      commit: true,
    });
    const { rows } = await db.admin.query("select via from public.audit_log where entity = 'tenants' and new = '\"Header\"'::jsonb");
    expect(rows[0].via).toBe("UI");
  });

  it("rejects an unknown value from the header", async () => {
    const code = await errorCode(
      db.asUser(f.alice, (q) => q("update public.tenants set name = 'x' where id = $1", [f.tenantA]), {
        headers: { "x-pv-via": "root" },
      }),
    );
    expect(code).toBe("P0001");
  });
});
