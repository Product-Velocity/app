import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #693: Confluence has its OWN connection, separate from Jira's. Who can change it, that its tokens stay out of reach and out of the audit log, that
// disconnecting it leaves Jira exactly as it was, and the one-refresh-at-a-time lease (Atlassian's refresh token rotates).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
const DENIED = "42501";
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-cf@example.test");
  service = await createUser(db, "service-cf@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
});
afterAll(async () => { await db.close(); });

const conn = async (tenant: string) => (await db.admin.query("select id from public.confluence_connections where tenant_id = $1 and state = 'connected' limit 1", [tenant])).rows[0].id as string;
const state = async (id: string) => (await db.admin.query("select state from public.confluence_connections where id = $1", [id])).rows[0].state as string;
const creds = async (id: string) => (await db.admin.query("select * from public.confluence_credentials where connection_id = $1", [id])).rows;
const jiraState = async (tenant: string) => (await db.admin.query("select state, scopes from public.jira_connections where tenant_id = $1", [tenant])).rows[0];

describe("who can change a Confluence connection", () => {
  it("signed-in people can read their own workspace's connection and never write it", async () => {
    const id = await conn(f.tenantA);
    const rows = await db.asUser(f.alice, async (q) => (await q("select id, sites from public.confluence_connections where tenant_id = $1", [f.tenantA])).rows);
    expect(rows.map((r) => r.id)).toContain(id);
    for (const sql of [
      "update public.confluence_connections set state = 'disconnected' where tenant_id = $1",
      "delete from public.confluence_connections where tenant_id = $1",
      "insert into public.confluence_connections (tenant_id) values ($1)",
    ]) {
      let affected = 0;
      const code = await errorCode(db.asUser(f.alice, async (q) => { affected = (await q(sql, [f.tenantA])).rowCount ?? 0; }, { commit: true }));
      expect(code === DENIED || (code === null && affected === 0), sql).toBe(true);
    }
    expect(await state(id)).toBe("connected");
  });
  it("nobody reads the credentials through the API, not even an admin of that workspace; another workspace sees no connection", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.confluence_credentials where tenant_id = $1", [f.tenantA])))).toBe(DENIED);
    expect((await db.asUser(f.bob, (q) => q("select id from public.confluence_connections where tenant_id = $1", [f.tenantA]))).rowCount).toBe(0);
  });
  it("the credentials table has no audit trigger (only the guards), so a token never reaches the audit log", async () => {
    const { rows } = await db.admin.query(`select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'confluence_credentials' and not t.tgisinternal`);
    expect(rows.map((r) => r.tgname).sort()).toEqual(["a_platform_readonly_guard", "b_platform_suspended_guard"]);
  });
  it("the sites must be a list, and a workspace has at most one live Confluence connection", async () => {
    expect(await errorCode(db.admin.query("insert into public.confluence_connections (tenant_id, sites) values ($1, '{}'::jsonb)", [f.tenantA]))).toBe(CHECK);
    expect(await errorCode(db.admin.query("insert into public.confluence_connections (tenant_id) values ($1)", [f.tenantA]))).toBe("23505");
  });
});

describe("confluence_disconnect", () => {
  it("a human admin ends the Confluence connection and the tokens are deleted at once; Jira is untouched", async () => {
    const id = await conn(f.tenantA);
    const jiraBefore = await jiraState(f.tenantA);
    expect((await creds(id)).length).toBe(1);
    await db.asUser(f.alice, (q) => q("select public.confluence_disconnect($1)", [id]), { commit: true });
    expect(await state(id)).toBe("disconnected");
    expect(await creds(id)).toEqual([]);
    expect(await jiraState(f.tenantA)).toEqual(jiraBefore);
    expect(jiraBefore.state).toBe("connected");
  });
  it("after a disconnect the workspace can connect again (a new live connection), and the old row stays as history", async () => {
    const again = await db.admin.query("insert into public.confluence_connections (tenant_id, state) values ($1, 'connected') returning id", [f.tenantA]).then((r) => r.rows[0].id as string);
    expect((await db.admin.query("select count(*)::int as n from public.confluence_connections where tenant_id = $1", [f.tenantA])).rows[0].n).toBe(2);
    expect(await state(again)).toBe("connected");
  });
  it("creators, service accounts, Claude and admins of another workspace cannot", async () => {
    const id = await conn(f.tenantB);
    expect(await errorCode(db.asUser(creator, (q) => q("select public.confluence_disconnect($1)", [id]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(service, (q) => q("select public.confluence_disconnect($1)", [id]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.confluence_disconnect($1)", [id]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.confluence_disconnect($1)", [id]), { commit: true, via: "MCP" }))).toBe(DENIED);
    expect(await state(id)).toBe("connected");
    expect((await creds(id)).length).toBe(1);
  });
  it("the change is audited without any token", async () => {
    const id = await conn(f.tenantB);
    await db.asUser(f.bob, (q) => q("select public.confluence_disconnect($1)", [id]), { commit: true });
    const { rows } = await db.admin.query("select field, old, new from public.audit_log where entity = 'confluence_connections' and entity_id = $1", [id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/token/i);
  });
});

describe("one refresh at a time (the refresh token rotates)", () => {
  it("only the first caller gets the lease; it is free again when it runs out or the tokens are stored", async () => {
    const id = await db.admin.query("insert into public.confluence_connections (tenant_id) values ($1) returning id", [f.tenantB]).then((r) => r.rows[0].id as string);
    await db.admin.query("insert into public.confluence_credentials (connection_id, tenant_id, access_token_enc, key_id, access_expires_at) values ($1, $2, 'a', 'k1', now())", [id, f.tenantB]);
    const claim = () => db.asService(async (q) => (await q("select public.confluence_refresh_claim($1, 30) as ok", [id])).rows[0].ok as boolean, { commit: true });
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await db.admin.query("update public.confluence_credentials set refresh_lease_until = now() - interval '1 second' where connection_id = $1", [id]);
    expect(await claim()).toBe(true);
  });
  it("signed-in users cannot call it", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.confluence_refresh_claim($1, 30)", ["00000000-0000-0000-0000-000000000000"]), { commit: true }))).toBe(DENIED);
  });
});
