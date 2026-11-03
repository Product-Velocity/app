import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
beforeAll(async () => { db = await createTestDb(); f = await twoTenantFixture(db); });
afterAll(async () => { await db.close(); });

const rows = async (sql: string, p: unknown[] = []) => (await db.admin.query(sql, p)).rows;
const adopt = (c: string) => db.asService(async (q) => (await q("select public.github_adopt_orphans($1) as r", [c])).rows[0].r as Record<string, number>, { commit: true });
const connect = async (tenant: string, login: string) => (await rows("insert into public.github_connections (tenant_id, expected_account, installation_id, account_login, account_type, repository_selection, state) values ($1, $2, $3, $2, 'Organization', 'all', 'connected') returning id", [tenant, login, Math.floor(Math.random() * 1e9) + 1]))[0].id as string;

describe("connecting GitHub again after a disconnect", () => {
  it("moves the links, incoming records and rules of the disconnected connection of the same account to the new one", async () => {
    const [old] = await rows("select id from public.github_connections where tenant_id = $1", [f.tenantA]);
    await db.admin.query("update public.github_connections set state = 'disconnected' where id = $1", [old.id]);
    const fresh = await connect(f.tenantA, "SEED-ORG"); // login compared without case
    expect(await adopt(fresh)).toMatchObject({ links: 1, issues: 1, rules: 1 });
    expect((await rows("select count(*)::int n from public.item_github_links where connection_id = $1", [fresh]))[0].n).toBe(1);
    expect((await rows("select count(*)::int n from public.item_github_links where connection_id = $1", [old.id]))[0].n).toBe(0);
  });
  it("is repeatable and moves nothing the second time", async () => {
    const [fresh] = await rows("select id from public.github_connections where tenant_id = $1 and state = 'connected'", [f.tenantA]);
    expect(await adopt(fresh.id)).toMatchObject({ links: 0, issues: 0, rules: 0 });
  });
  it("never takes rows of another workspace or of another account", async () => {
    const [b] = await rows("select connection_id from public.item_github_links where tenant_id = $1", [f.tenantB]);
    const [t] = await rows("select id from public.github_connections where tenant_id = $1", [f.tenantB]);
    await db.admin.query("update public.github_connections set state = 'disconnected' where id = $1", [t.id]);
    const other = await connect(f.tenantB, "another-org");
    expect(await adopt(other)).toMatchObject({ links: 0, issues: 0, rules: 0 });
    expect((await rows("select connection_id from public.item_github_links where tenant_id = $1", [f.tenantB]))[0].connection_id).toBe(b.connection_id);
  });
  it("only the service role may call it", async () => {
    await expect(db.asUser(f.alice, (q) => q("select public.github_adopt_orphans($1)", [f.tenantA]))).rejects.toThrow();
  });
});
