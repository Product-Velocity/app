import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
beforeAll(async () => { db = await createTestDb(); f = await twoTenantFixture(db); });
afterAll(async () => { await db.close(); });

const one = async (sql: string, p: unknown[] = []) => (await db.admin.query(sql, p)).rows;
const adopt = (c: string) => db.asService(async (q) => (await q("select public.jira_adopt_orphans($1) as r", [c])).rows[0].r as Record<string, number>, { commit: true });

describe("signing in to Jira again after a disconnect", () => {
  it("moves the project link, initiative links and issues of the disconnected connection to the new one, for the same site only", async () => {
    const [old] = await one("select id from public.jira_connections where tenant_id = $1", [f.tenantA]);
    await db.admin.query("update public.jira_connections set state = 'disconnected' where id = $1", [old.id]);
    const [fresh] = await one("insert into public.jira_connections (tenant_id, sites, scopes, state) values ($1, '[{\"id\":\"site-1\",\"name\":\"Seed site\"}]'::jsonb, 'read:jira-work', 'connected') returning id", [f.tenantA]);
    const r = await adopt(fresh.id);
    expect(r).toMatchObject({ links: 1, items: 1, issues: 1 });
    expect((await one("select count(*)::int n from public.jira_project_links where connection_id = $1", [fresh.id]))[0].n).toBe(1);
    expect((await one("select count(*)::int n from public.item_jira_links where connection_id = $1", [fresh.id]))[0].n).toBe(1);
    expect((await one("select count(*)::int n from public.jira_issues where connection_id = $1", [fresh.id]))[0].n).toBe(1);
    expect((await one("select count(*)::int n from public.jira_project_links where connection_id = $1", [old.id]))[0].n).toBe(0);
  });
  it("is repeatable and moves nothing the second time", async () => {
    const [fresh] = await one("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA]);
    expect(await adopt(fresh.id)).toMatchObject({ links: 0, items: 0, issues: 0, webhooks: 0 });
  });
  it("never touches another workspace", async () => {
    const [b] = await one("select connection_id from public.jira_project_links where tenant_id = $1", [f.tenantB]);
    const [fresh] = await one("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA]);
    await adopt(fresh.id);
    expect((await one("select connection_id from public.jira_project_links where tenant_id = $1", [f.tenantB]))[0].connection_id).toBe(b.connection_id);
  });
  it("a different Jira site is not taken over", async () => {
    const [t] = await one("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB]);
    await db.admin.query("update public.jira_connections set state = 'disconnected' where id = $1", [t.id]);
    const [fresh] = await one("insert into public.jira_connections (tenant_id, sites, scopes, state) values ($1, '[{\"id\":\"other-site\",\"name\":\"Other\"}]'::jsonb, 'read:jira-work', 'connected') returning id", [f.tenantB]);
    expect(await adopt(fresh.id)).toMatchObject({ links: 0, items: 0, issues: 0 });
  });
  it("only the service role may call it", async () => {
    await expect(db.asUser(f.alice, (q) => q("select public.jira_adopt_orphans($1)", [f.tenantA]))).rejects.toThrow();
  });
});
