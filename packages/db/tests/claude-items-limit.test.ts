import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #667: the daily Claude item limit is 1000 by default and platform staff can set one workspace's own. Two tenants (rule 1).
const DENIED = "42501";
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let pat: string;
const asPat = <T,>(fn: Parameters<TestDb["asUser"]>[1], o?: Parameters<TestDb["asUser"]>[2]) => db.asUser(pat, fn as never, o) as Promise<T>;
const setLimit = (tenant: string, limit: number | null, reason: string | null = null) =>
  asPat((q) => q("select public.platform_set_claude_items_limit($1, $2, $3)", [tenant, limit, reason]), { commit: true });
const connect = (user: string, tenant: string, client: string) =>
  db.asUser(user, async (q) => (await q("select public.mcp_connect($1, $2, 'Claude') as id", [tenant, client])).rows[0].id as string, { commit: true });
const record = (user: string, client: string, conn: string, items = 0) =>
  db.asUser(user, async (q) => (await q("select public.mcp_record_call($1, $2, 0) as r", [conn, items])).rows[0].r, { claims: { client_id: client }, commit: true });
const limitFor = (user: string, tenant: string) =>
  db.asUser(user, async (q) => (await q("select public.mcp_limits_for($1) as l", [tenant])).rows[0].l);

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  pat = await createUser(db, "pat-limit@platform.test");
  await db.admin.query("insert into platform.admins (user_id) values ($1)", [pat]);
  await db.admin.query("update public.tenants set claude_enabled = true");
});
afterAll(async () => { await db.close(); });

describe("daily Claude item limit", () => {
  it("defaults to 1000 for every workspace", async () => {
    expect((await db.admin.query("select public.mcp_limits() ->> 'workspace_items_per_day' as n")).rows[0].n).toBe("1000");
    expect((await limitFor(f.alice, f.tenantA)).workspace_items_per_day).toBe(1000);
    expect((await limitFor(f.bob, f.tenantB)).workspace_items_per_day).toBe(1000);
  });

  it("platform staff set one workspace's limit; the other keeps the default; it is logged", async () => {
    await setLimit(f.tenantA, 5000, "bulk import");
    expect((await limitFor(f.alice, f.tenantA)).workspace_items_per_day).toBe(5000);
    expect((await limitFor(f.bob, f.tenantB)).workspace_items_per_day).toBe(1000);
    const cfg = (await db.admin.query("select new, target_tenant from platform.config_log where field = 'claude_items_per_day' order by at desc limit 1")).rows[0];
    expect(cfg).toMatchObject({ new: 5000, target_tenant: f.tenantA });
    const audit = (await db.admin.query("select new from public.audit_log where tenant_id = $1 and entity = 'platform_access' and field = 'claude_items_per_day'", [f.tenantA])).rows[0];
    expect(audit.new).toMatchObject({ limit: 5000, reason: "bulk import" });
  });

  it("the meter uses the workspace's own limit, and clearing it goes back to the default", async () => {
    await setLimit(f.tenantB, 3);
    const id = await connect(f.bob, f.tenantB, "c-own-limit");
    expect(await record(f.bob, "c-own-limit", id, 3)).toEqual({ ok: true });
    expect(await record(f.bob, "c-own-limit", id, 1)).toMatchObject({ ok: false, reason: "workspace_items", limit: 3, used: 3 });
    await setLimit(f.tenantB, null);
    expect(await record(f.bob, "c-own-limit", id, 1)).toEqual({ ok: true });
    expect((await db.admin.query("select claude_items_per_day from public.tenants where id = $1", [f.tenantB])).rows[0].claude_items_per_day).toBeNull();
  });

  it("a workspace admin cannot change it, and cannot read another workspace's", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.tenants set claude_items_per_day = 99999 where id = $1", [f.tenantA]), { commit: true }))).toBe(DENIED); // no column grant
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.platform_set_claude_items_limit($1, 99999, null)", [f.tenantA]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.platform_claude_limit($1)", [f.tenantA])))).toBe(DENIED);
    expect(await errorCode(limitFor(f.alice, f.tenantB))).toBe(DENIED);
    expect(await errorCode(limitFor(f.bob, f.tenantA))).toBe(DENIED);
  });

  it("refuses values outside 1 to 100000 and an unknown account", async () => {
    expect(await errorCode(setLimit(f.tenantA, 0))).toBe("22023");
    expect(await errorCode(setLimit(f.tenantA, 100001))).toBe("22023");
    expect(await errorCode(asPat((q) => q("select public.platform_set_claude_items_limit(gen_random_uuid(), 10, null)"), { commit: true }))).toBe("P0002");
  });

  it("platform_claude_limit shows the override, the effective limit and today's use", async () => {
    await setLimit(f.tenantA, 2500);
    const r = await asPat<{ override: number; effective: number; used_today: number }>(async (q) => (await q("select * from public.platform_claude_limit($1)", [f.tenantA])).rows[0]);
    expect(r).toMatchObject({ override: 2500, effective: 2500 });
    expect(typeof r.used_today).toBe("number");
  });
});
