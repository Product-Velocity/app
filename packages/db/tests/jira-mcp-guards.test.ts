import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Claude (MCP) must never change Jira connections or project links, even when the signed-in person is a human admin.
// The write source was renamed 'Claude MCP' -> 'MCP' (20261103004500); this pins that the refusal still fires after the rename.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => { await db.close(); });

const asAdmin = (via: string, sql: string, params: unknown[]) => db.asUser(f.alice, (q) => q(sql, params), { commit: true, via });
const connOf = async () => (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected' limit 1", [f.tenantA])).rows[0].id as string;

describe("Jira connection and project-link functions refuse a human admin acting through MCP", () => {
  it("jira_disconnect: refused, connection and tokens untouched; the same call from the UI works", async () => {
    const c = await connOf();
    const creds = async () => (await db.admin.query("select count(*)::int n from public.jira_credentials where connection_id = $1", [c])).rows[0].n as number;
    const before = await creds();
    expect(await errorCode(asAdmin("MCP", "select public.jira_disconnect($1)", [c]))).toBe(DENIED);
    expect((await db.admin.query("select state from public.jira_connections where id = $1", [c])).rows[0].state).toBe("connected");
    expect(await creds()).toBe(before);
    await asAdmin("UI", "select public.jira_disconnect($1)", [c]); // proves the admin could do it, so the refusal above was the source check
    expect((await db.admin.query("select state from public.jira_connections where id = $1", [c])).rows[0].state).toBe("disconnected");
  });

  it("jira_link_project and jira_unlink_project: refused through MCP, nothing changes; the UI can link and unlink", async () => {
    await db.admin.query("insert into public.jira_connections (tenant_id, sites, scopes, state) values ($1, '[{\"id\":\"site-1\",\"name\":\"S\"}]'::jsonb, 'read:jira-work', 'connected')", [f.tenantA]);
    const c = await connOf();
    const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'MCP guard') returning id", [f.tenantA])).rows[0].id as string;
    const count = async () => (await db.admin.query("select count(*)::int n from public.jira_project_links where project_id = $1", [p])).rows[0].n as number;
    const link = (via: string) => asAdmin(via, "select public.jira_link_project($1, $2, 'site-1', '10000', 'GRD', 'Guard', '10001', 'Epic', '10002', 'Story', null, null)", [p, c]);
    expect(await errorCode(link("MCP"))).toBe(DENIED);
    expect(await count()).toBe(0);
    await link("UI");
    expect(await count()).toBe(1);
    expect(await errorCode(asAdmin("MCP", "select public.jira_unlink_project($1)", [p]))).toBe(DENIED);
    expect(await count()).toBe(1);
    await asAdmin("UI", "select public.jira_unlink_project($1)", [p]);
    expect(await count()).toBe(0);
  });

  it("no function in the database still compares the write source with the old name 'Claude MCP' (only write_source() itself names it, to refuse it)", async () => {
    const r = await db.admin.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname in ('public', 'pv_internal') where p.prosrc like '%''Claude MCP''%' order by 1");
    expect(r.rows.map((x) => x.proname)).toEqual(["write_source"]);
  });
});
