import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, invitationId: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const OLD = "old-token-value", NEW = "new-token-value";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-invite@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  invitationId = (await db.admin.query("insert into public.invitations (tenant_id, email, role, token_hash) values ($1, 'new.person@example.test', 'viewer', $2) returning id", [f.tenantA, hash(OLD)])).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("invitation emails", () => {
  it("start as not sent, and signed-in users cannot write the delivery state", async () => {
    expect((await db.admin.query("select email_status, email_send_count from public.invitations where id = $1", [invitationId])).rows[0]).toMatchObject({ email_status: "not_sent", email_send_count: 0 });
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.invitations set email_status = 'delivered' where id = $1", [invitationId])))).toBe("42501");
  });
  it("resend gives a new token and 7 more days, and the old link stops working", async () => {
    await db.admin.query("update public.invitations set email_status = 'bounced', email_error = 'x', expires_at = now() + interval '1 day' where id = $1", [invitationId]);
    await db.asUser(f.alice, (q) => q("select public.invitation_reissue($1, $2)", [invitationId, hash(NEW)]), { commit: true, via: "UI" });
    const r = (await db.admin.query("select token_hash, email_status, email_error, expires_at > now() + interval '6 days' as fresh from public.invitations where id = $1", [invitationId])).rows[0];
    expect(r).toMatchObject({ token_hash: hash(NEW), email_status: "not_sent", email_error: null, fresh: true });
    const old = (await db.admin.query("select count(*)::int as n from public.invitations where token_hash = $1", [hash(OLD)])).rows[0].n;
    expect(old).toBe(0);
  });
  it("only an admin of the workspace can reissue; used and revoked ones cannot", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.invitation_reissue($1, $2)", [invitationId, hash("x")])))).toBe("42501");
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.invitation_reissue($1, $2)", [invitationId, hash("y")])))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.invitation_reissue($1, $2)", [invitationId, "not-a-hash"])))).toBe("22023");
    await db.admin.query("update public.invitations set revoked_at = now() where id = $1", [invitationId]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.invitation_reissue($1, $2)", [invitationId, hash("z")])))).toBe("22023");
  });
});
