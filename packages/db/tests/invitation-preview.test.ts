import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, hashToken, inviteRow, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

const preview = (token: string, as: "anon" | string = "anon") => {
  const run = (q: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) =>
    q("select * from public.invitation_preview($1)", [token]).then((r) => r.rows);
  return as === "anon" ? db.asAnon(run) : db.asUser(as, run);
};

const invite = async (email: string, role = "creator", approver = false) => {
  const token = `preview-${email}-${Math.random()}`;
  await db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, email, role, token, approver), { commit: true });
  return token;
};

describe("invitation_preview", () => {
  it("shows workspace name, email, role and Approver flag for a valid link, even before sign-in", async () => {
    const token = await invite("new@example.test", "creator", true);
    const rows = await preview(token);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_name: "Tenant A",
      email: "new@example.test",
      role: "creator",
      is_approver: true,
    });
  });

  it("works for signed-in users too", async () => {
    const token = await invite("signedin@example.test");
    expect(await preview(token, f.dave)).toHaveLength(1);
  });

  it("returns nothing for an unknown token, an empty token and null", async () => {
    expect(await preview("nope")).toEqual([]);
    expect(await preview("")).toEqual([]);
    const rows = await db.asAnon(async (q) => (await q("select * from public.invitation_preview(null)")).rows);
    expect(rows).toEqual([]);
  });

  it("returns nothing once the invitation is revoked, expired or accepted", async () => {
    const revoked = await invite("revoked@example.test");
    await db.asUser(f.alice, (q) => q("update public.invitations set revoked_at = now() where token_hash = $1", [hashToken(revoked)]), { commit: true });
    expect(await preview(revoked)).toEqual([]);

    const expired = await invite("expired@example.test");
    await db.admin.query("update public.invitations set expires_at = now() - interval '1 minute' where token_hash = $1", [hashToken(expired)]);
    expect(await preview(expired)).toEqual([]);

    const user = await createUser(db, "accepted@example.test");
    const used = await invite("accepted@example.test");
    await db.asUser(user, (q) => q("select public.accept_invitation($1)", [used]), { commit: true });
    expect(await preview(used)).toEqual([]);
  });

  it("cannot be used to list invitations: it only answers for the exact token", async () => {
    await invite("secret-list@example.test");
    for (const guess of ["%", "_", "preview-", "secret-list@example.test"]) {
      expect(await preview(guess)).toEqual([]);
    }
  });
});
