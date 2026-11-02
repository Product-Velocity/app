import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
const DENIED = "42501";
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-jira@example.test");
  service = await createUser(db, "service-jira@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
});
afterAll(async () => {
  await db.close();
});

const conn = async (tenant: string) => (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected' limit 1", [tenant])).rows[0].id as string;
const state = async (id: string) => (await db.admin.query("select state from public.jira_connections where id = $1", [id])).rows[0].state as string;
const creds = async (id: string) => (await db.admin.query("select * from public.jira_credentials where connection_id = $1", [id])).rows;

describe("who can change a Jira connection", () => {
  it("signed-in people can read their own workspace's connection and never write it", async () => {
    const id = await conn(f.tenantA);
    const rows = await db.asUser(f.alice, async (q) => (await q("select id, sites from public.jira_connections where tenant_id = $1", [f.tenantA])).rows);
    expect(rows.map((r) => r.id)).toContain(id);
    for (const sql of [
      "update public.jira_connections set state = 'disconnected' where tenant_id = $1",
      "delete from public.jira_connections where tenant_id = $1",
      "insert into public.jira_connections (tenant_id) values ($1)",
    ]) {
      let affected = 0;
      const code = await errorCode(db.asUser(f.alice, async (q) => { affected = (await q(sql, [f.tenantA])).rowCount ?? 0; }, { commit: true }));
      expect(code === DENIED || (code === null && affected === 0), sql).toBe(true);
    }
    expect(await state(id)).toBe("connected");
  });
  it("nobody reads the credentials through the API, not even an admin of that workspace", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.jira_credentials where tenant_id = $1", [f.tenantA])))).toBe(DENIED);
  });
  it("the credentials table has no audit trigger (only the platform read-only guard), so a token never reaches the audit log", async () => {
    const { rows } = await db.admin.query(
      `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'jira_credentials' and not t.tgisinternal`,
    );
    expect(rows.map((r) => r.tgname)).toEqual(["a_platform_readonly_guard"]);
  });
  it("the connection's sites must be a list", async () => {
    expect(await errorCode(db.admin.query("insert into public.jira_connections (tenant_id, sites) values ($1, '{}'::jsonb)", [f.tenantA]))).toBe(CHECK);
  });
});

describe("jira_disconnect", () => {
  it("a human admin ends the connection and the tokens are deleted at once", async () => {
    const id = await conn(f.tenantA);
    expect((await creds(id)).length).toBe(1);
    await db.asUser(f.alice, (q) => q("select public.jira_disconnect($1)", [id]), { commit: true });
    expect(await state(id)).toBe("disconnected");
    expect(await creds(id)).toEqual([]);
  });
  it("creators, service accounts, Claude and admins of another workspace cannot", async () => {
    const id = await conn(f.tenantB);
    expect(await errorCode(db.asUser(creator, (q) => q("select public.jira_disconnect($1)", [id]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(service, (q) => q("select public.jira_disconnect($1)", [id]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_disconnect($1)", [id]), { commit: true }))).toBe(DENIED); // alice is admin of A, not B
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.jira_disconnect($1)", [id]), { commit: true, via: "Claude MCP" }))).toBe(DENIED);
    expect(await state(id)).toBe("connected");
    expect((await creds(id)).length).toBe(1);
  });
  it("the change is audited without any token", async () => {
    const id = await conn(f.tenantB);
    await db.asUser(f.bob, (q) => q("select public.jira_disconnect($1)", [id]), { commit: true });
    const { rows } = await db.admin.query("select field, old, new from public.audit_log where entity = 'jira_connections' and entity_id = $1", [id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/token/i);
  });
});

describe("one refresh at a time (the refresh token rotates)", () => {
  it("only the first caller gets the lease; it is free again when it runs out or the tokens are stored", async () => {
    const id = await db.admin.query("insert into public.jira_connections (tenant_id) values ($1) returning id", [f.tenantA]).then((r) => r.rows[0].id as string);
    await db.admin.query("insert into public.jira_credentials (connection_id, tenant_id, access_token_enc, key_id, access_expires_at) values ($1, $2, 'a', 'k1', now())", [id, f.tenantA]);
    const claim = () => db.asService(async (q) => (await q("select public.jira_refresh_claim($1, 30) as ok", [id])).rows[0].ok as boolean, { commit: true });
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await db.admin.query("update public.jira_credentials set refresh_lease_until = now() - interval '1 second' where connection_id = $1", [id]);
    expect(await claim()).toBe(true);
    await db.admin.query("update public.jira_credentials set refresh_lease_until = null where connection_id = $1", [id]);
    expect(await claim()).toBe(true);
  });
  it("signed-in users cannot call it", async () => {
    const id = await conn(f.tenantA).catch(() => "00000000-0000-0000-0000-000000000000");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_refresh_claim($1, 30)", [id]), { commit: true }))).toBe(DENIED);
  });
});
