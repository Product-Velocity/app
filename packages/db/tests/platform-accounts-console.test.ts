import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// All accounts console v2 (decision 2026-11-22-platform-accounts-console): pause, the richer list, the members drawer and the narrow
// member-action exception. Two tenants everywhere (rule 1); a platform admin is never a member.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let pat: string;
const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);
const HASH3 = "c".repeat(64);

const asPat = <T,>(fn: Parameters<TestDb["asUser"]>[1], o?: Parameters<TestDb["asUser"]>[2]) => db.asUser(pat, fn as never, o) as Promise<T>;
const reset = async () => {
  await db.admin.query("update platform.admins set access_level = null");
  await db.admin.query("update platform.settings set default_access_level = 'read_write'");
  await db.admin.query("delete from platform.account_overrides");
  await db.admin.query("update platform.entries set left_at = now() where left_at is null");
  await db.admin.query("update public.tenants set suspended_at = null");
  await db.admin.query("update auth.users set last_sign_in_at = now() where id = $1", [pat]);
};

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  pat = await createUser(db, "pat@platform.test");
  await db.admin.query("insert into platform.admins (user_id) values ($1)", [pat]);
  await reset();
});
afterAll(async () => { await db.close(); });

type Account = { tenant_id: string; name: string; item_count: number; invited_count: number; ai_agents: { name: string; connections: number }[]; github_state: string | null; suspended_at: string | null; created_at: string; company_url: string | null };
const list = () => asPat<Account[]>(async (q) => (await q("select * from public.platform_accounts()")).rows);

describe("the account list", () => {
  it("carries item counts, pending invitations, the company URL, created date and connected AI agents, per account", async () => {
    await db.admin.query("update public.tenants set company_url = 'https://a.example.test' where id = $1", [f.tenantA]);
    await db.admin.query(
      `insert into public.mcp_connections (tenant_id, user_id, client_id, client_name, last_used_at, call_count) values ($1, $2, 'c1', 'Claude Desktop', now(), 7), ($1, $3, 'c2', 'Claude Desktop', null, 0)`,
      [f.tenantA, f.alice, f.carol]);
    await db.admin.query(
      `insert into public.mcp_connections (tenant_id, user_id, client_id, client_name, revoked_at) values ($1, $2, 'c3', 'Cursor', now())`, [f.tenantA, f.dave]);
    const rows = await list();
    const a = rows.find((r) => r.tenant_id === f.tenantA)!;
    const b = rows.find((r) => r.tenant_id === f.tenantB)!;
    const itemsA = (await db.admin.query("select count(*)::int n from public.items where tenant_id = $1", [f.tenantA])).rows[0].n;
    expect(a.item_count).toBe(itemsA);
    expect(a.invited_count).toBe(1);
    expect(a.company_url).toBe("https://a.example.test");
    expect(a.created_at).toBeTruthy();
    expect(a.ai_agents).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Claude Desktop", connections: 2 })]));
    expect(a.ai_agents.map((x) => x.name)).not.toContain("Cursor"); // a revoked connection is not listed
    expect(b.ai_agents.map((x) => x.name)).not.toContain("Claude Desktop"); // another account's agents never show up here
  });

  it("is refused to everybody who is not a platform admin", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.platform_accounts()")))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.platform_account_members($1)", [f.tenantA])))).toBe("42501");
  });
});

describe("pause access", () => {
  it("only a platform admin can pause or resume", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.platform_set_suspended($1, true, 'x')", [f.tenantA])))).toBe("42501");
    expect(await errorCode(asPat((q) => q("select public.platform_set_suspended(gen_random_uuid(), true, 'x')")))).toBe("P0002");
  });

  it("a paused account gives its members nothing, leaves the other account alone, and is logged both places", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_suspended($1, true, 'unpaid invoice')", [f.tenantA]), { commit: true });
    expect((await db.asUser(f.alice, (q) => q("select id from public.items"))).rowCount).toBe(0);
    expect((await db.asUser(f.alice, (q) => q("select id from public.tenants"))).rowCount).toBe(0);
    expect((await db.asUser(f.bob, (q) => q("select id from public.items"))).rowCount).toBeGreaterThan(0);
    const states = await db.asUser(f.alice, async (q) => (await q("select tenant_id, status from public.my_access_requests()")).rows);
    expect(states).toEqual([{ tenant_id: f.tenantA, status: "account_paused" }]);
    const cfg = (await db.admin.query("select field, new from platform.config_log where target_tenant = $1 order by id desc limit 1", [f.tenantA])).rows[0];
    expect(cfg).toMatchObject({ field: "account_paused", new: { reason: "unpaid invoice" } });
    const aud = (await db.admin.query("select actor_role, actor_platform_admin from public.audit_log where tenant_id = $1 and field = 'account_paused'", [f.tenantA])).rows;
    expect(aud).toEqual([{ actor_role: "platform_admin", actor_platform_admin: true }]);
  });

  it("writes by a signed-in member are refused even through a path RLS does not cover", async () => {
    await reset();
    await db.admin.query("update public.tenants set suspended_at = now() where id = $1", [f.tenantA]);
    // RLS already hides the rows; this proves the trigger on its own, as a signed-in member whose statement is not filtered by RLS
    const asAliceNoRls = async (sql: string) => {
      await db.admin.query("begin");
      try {
        await db.admin.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.alice, role: "authenticated" })]);
        await db.admin.query(sql);
        await db.admin.query("rollback");
      } catch (e) { await db.admin.query("rollback"); throw e; }
    };
    expect(await errorCode(asAliceNoRls(`update public.projects set name = 'x' where tenant_id = '${f.tenantA}'`))).toBe("PV025");
    expect(await errorCode(asAliceNoRls(`update public.projects set name = 'x' where tenant_id = '${f.tenantB}'`))).toBe(null);
    await reset();
  });

  it("a platform admin can still enter and work in a paused account; resuming gives the members their access back", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_suspended($1, true, null)", [f.tenantA]), { commit: true });
    await asPat((q) => q("select * from public.platform_enter_account($1, 'check')", [f.tenantA]), { commit: true });
    expect((await asPat<{ rowCount: number }>((q) => q("select id from public.items where tenant_id = $1", [f.tenantA]))).rowCount).toBeGreaterThan(0);
    await asPat((q) => q("select public.platform_set_suspended($1, false, null)", [f.tenantA]), { commit: true });
    expect((await db.asUser(f.alice, (q) => q("select id from public.items"))).rowCount).toBeGreaterThan(0);
    expect((await db.asUser(f.alice, (q) => q("select * from public.my_access_requests()"))).rowCount).toBe(0);
    await reset();
  });

  it("the list shows who is paused", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_suspended($1, true, null)", [f.tenantB]), { commit: true });
    const rows = await list();
    expect(rows.find((r) => r.tenant_id === f.tenantB)!.suspended_at).toBeTruthy();
    expect(rows.find((r) => r.tenant_id === f.tenantA)!.suspended_at).toBeNull();
    await reset();
  });
});

describe("the members drawer", () => {
  it("lists people of every status and pending invitations, with the AI agents each person connected", async () => {
    await reset();
    const rows = await asPat<{ kind: string; email: string; status: string; ai_agents: string[]; role: string }[]>(
      async (q) => (await q("select * from public.platform_account_members($1)", [f.tenantA])).rows, { commit: true });
    expect(rows.filter((r) => r.kind === "member").map((r) => r.email).sort()).toEqual(["alice@example.test", "carol@example.test"]);
    expect(rows.find((r) => r.email === "alice@example.test")!.ai_agents).toContain("Claude Desktop");
    expect(rows.find((r) => r.kind === "invitation")).toMatchObject({ email: "pending-a@example.test", status: "invited" });
    expect(rows.some((r) => r.email.includes("bob@"))).toBe(false); // tenant B is not in tenant A's list
    const log = (await db.admin.query("select 1 from platform.config_log where field = 'members_viewed' and target_tenant = $1", [f.tenantA])).rowCount;
    expect(log).toBeGreaterThan(0);
  });
});

describe("member actions by a platform admin (the narrow exception)", () => {
  it("invites a person (never Approver), audited as the platform admin in the account's log and in the configuration log", async () => {
    await reset();
    const out = await asPat<{ invitation_id: string; tenant_name: string }>(async (q) => (await q("select * from public.platform_invite_member($1, ' New.Person@Example.test ', 'creator', $2)", [f.tenantA, HASH])).rows[0], { commit: true });
    const id = out.invitation_id;
    expect(out.tenant_name).toBe("Tenant A");
    const inv = (await db.admin.query("select email, role, is_approver, created_by from public.invitations where id = $1", [id])).rows[0];
    expect(inv).toEqual({ email: "new.person@example.test", role: "creator", is_approver: false, created_by: pat });
    const aud = (await db.admin.query("select actor_role from public.audit_log where tenant_id = $1 and field = 'member_invited'", [f.tenantA])).rows;
    expect(aud).toEqual([{ actor_role: "platform_admin" }]);
    expect((await db.admin.query("select 1 from platform.config_log where field = 'member_invited' and target_tenant = $1", [f.tenantA])).rowCount).toBe(1);
  });

  it("works for an admin who has entered the account too (the exception is only these functions)", async () => {
    await reset();
    await asPat((q) => q("select * from public.platform_enter_account($1, 'x')", [f.tenantA]), { commit: true });
    await asPat((q) => q("select * from public.platform_invite_member($1, 'second@example.test', 'viewer', $2)", [f.tenantA, HASH2]), { commit: true });
    // while a plain table write is still refused
    expect(await errorCode(db.asUser(pat, (q) => q(`insert into public.invitations (tenant_id, email, role, token_hash) values ('${f.tenantA}', 'x@y.test', 'viewer', 'hh')`), { commit: true }))).toBe("PV022");
    await reset();
  });

  it("refuses: an existing member, a duplicate pending invitation, non-admins, a bad role, read-only access, a stale sign-in", async () => {
    await reset();
    expect(await errorCode(asPat((q) => q("select * from public.platform_invite_member($1, 'carol@example.test', 'viewer', $2)", [f.tenantA, HASH])))).toBe("PV026");
    expect(await errorCode(asPat((q) => q("select * from public.platform_invite_member($1, 'pending-a@example.test', 'viewer', $2)", [f.tenantA, HASH])))).toBe("23505");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.platform_invite_member($1, 'z@example.test', 'viewer', $2)", [f.tenantA, HASH])))).toBe("42501");
    expect(await errorCode(asPat((q) => q("select * from public.platform_invite_member($1, 'z@example.test', 'owner', $2)", [f.tenantA, HASH])))).toBe("23514");
    await db.admin.query("insert into platform.account_overrides (tenant_id, access_level) values ($1, 'read_only')", [f.tenantA]);
    expect(await errorCode(asPat((q) => q("select * from public.platform_invite_member($1, 'z@example.test', 'viewer', $2)", [f.tenantA, HASH])))).toBe("PV021");
    await reset();
    await db.admin.query("update auth.users set last_sign_in_at = now() - interval '2 hours' where id = $1", [pat]);
    expect(await errorCode(asPat((q) => q("select * from public.platform_invite_member($1, 'z@example.test', 'viewer', $2)", [f.tenantA, HASH])))).toBe("PV020");
    await reset();
  });

  it("renews and cancels an invitation; a used or cancelled one cannot be changed again", async () => {
    await reset();
    const inv = (await db.admin.query("select id from public.invitations where tenant_id = $1 and email = 'pending-a@example.test'", [f.tenantA])).rows[0].id;
    const out = await asPat<{ email: string }[]>(async (q) => (await q("select * from public.platform_reissue_invitation($1, $2)", [inv, HASH3])).rows, { commit: true });
    expect(out[0].email).toBe("pending-a@example.test");
    expect((await db.admin.query("select token_hash from public.invitations where id = $1", [inv])).rows[0].token_hash).toBe(HASH3);
    await asPat((q) => q("select public.platform_cancel_invitation($1)", [inv]), { commit: true });
    expect(await errorCode(asPat((q) => q("select public.platform_cancel_invitation($1)", [inv])))).toBe("22023");
    expect(await errorCode(asPat((q) => q("select * from public.platform_reissue_invitation($1, $2)", [inv, HASH])))).toBe("22023");
  });

  it("pauses and resumes a member, but not a service account, not the last admin, and not a move the status table forbids", async () => {
    await reset();
    const carol = (await db.admin.query("select id from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, f.carol])).rows[0].id;
    await asPat((q) => q("select public.platform_set_member_status($1, 'paused')", [carol]), { commit: true });
    expect((await db.admin.query("select status from public.tenant_members where id = $1", [carol])).rows[0].status).toBe("paused");
    expect(await errorCode(asPat((q) => q("select public.platform_set_member_status($1, 'requested')", [carol])))).toBe("22023");
    await asPat((q) => q("select public.platform_set_member_status($1, 'active')", [carol]), { commit: true });
    expect(await errorCode(asPat((q) => q("select public.platform_set_member_status($1, 'active')", [carol])))).toBe("PV027");
    const alice = (await db.admin.query("select id from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, f.alice])).rows[0].id;
    expect(await errorCode(asPat((q) => q("select public.platform_set_member_status($1, 'revoked')", [alice])))).toBe("PV003");
    await db.admin.query("update public.tenant_members set is_service_account = true where id = $1", [carol]);
    expect(await errorCode(asPat((q) => q("select public.platform_set_member_status($1, 'paused')", [carol])))).toBe("PV027");
    await db.admin.query("update public.tenant_members set is_service_account = false where id = $1", [carol]);
    // tenant B's members are not reachable by an ordinary admin of A through this path either
    const bobRow = (await db.admin.query("select id from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantB, f.bob])).rows[0].id;
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.platform_set_member_status($1, 'paused')", [bobRow])))).toBe("42501");
  });

  it("the Approver flag cannot be reached through any of these functions", async () => {
    expect((await db.admin.query("select count(*)::int n from public.tenant_members where is_approver and tenant_id = $1", [f.tenantA])).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.invitations where is_approver and created_by = $1", [pat])).rows[0].n).toBe(0);
  });
});

describe("guard coverage", () => {
  it("every public table with a tenant has the paused-account guard, so a new table cannot be forgotten", async () => {
    const { rows } = await db.admin.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
          and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = case when c.relname = 'tenants' then 'id' else 'tenant_id' end and not a.attisdropped)
          and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'b_platform_suspended_guard')`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
