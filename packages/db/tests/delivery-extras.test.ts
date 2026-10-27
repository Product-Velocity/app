import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, itemA: string, unlinkedA: string, itemB: string, connA: string, connB: string;
const DENIED = "42501";

const apply = (conn: string, item: string, a: { open?: number | null; merged?: number | null; ci?: string | null; release?: string | null; repos?: string | null } = {}) =>
  db.asService(async (q) => (await q("select public.github_apply_extras($1, $2, $3, $4, $5, $6, $7) as r", [conn, item, a.open === undefined ? 1 : a.open, a.merged === undefined ? 2 : a.merged, a.ci === undefined ? "Passing" : a.ci, a.release === undefined ? "v1.0.0 · 2026-10-20" : a.release, a.repos === undefined ? "Acme/api, Acme/web" : a.repos])).rows[0].r as boolean, { commit: true });
const row = async (id: string) => (await db.admin.query("select open_prs, merged_prs, ci_status, latest_release, repositories from public.items where id = $1", [id])).rows[0];
const audits = async (id: string, field: string) => (await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'items' and entity_id = $1 and field = $2", [id, field])).rows[0].n as number;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-extras@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await db.admin.query("delete from public.item_github_links");
  const ids = (await db.admin.query("select id from public.items where tenant_id = $1 order by stack_rank limit 2", [f.tenantA])).rows.map((r) => r.id as string);
  [itemA, unlinkedA] = ids;
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  connB = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  for (const [t, i, c, n] of [[f.tenantA, itemA, connA, 1], [f.tenantB, itemB, connB, 2]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', 'push')", [t, i, c, n, 9400 + n]);
  }
});
afterAll(async () => { await db.close(); });

describe("pull requests, CI, release and repositories are written by the server only", () => {
  it("stores all five values, audited as GitHub", async () => {
    expect(await apply(connA, itemA)).toBe(true);
    expect(await row(itemA)).toEqual({ open_prs: 1, merged_prs: 2, ci_status: "Passing", latest_release: "v1.0.0 · 2026-10-20", repositories: "Acme/api, Acme/web" });
    const a = (await db.admin.query("select new #>> '{}' as v, actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'open_prs' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ v: "1", actor_id: null, via: "GitHub webhook" });
  });
  it("writes nothing when nothing changed, and applies a change", async () => {
    const before = await audits(itemA, "open_prs");
    expect(await apply(connA, itemA)).toBe(false);
    expect(await audits(itemA, "open_prs")).toBe(before);
    expect(await apply(connA, itemA, { open: 3 })).toBe(true);
    expect((await row(itemA)).open_prs).toBe(3);
  });
  it("a null CI status leaves the last one (a run in progress), a release and repositories can be emptied", async () => {
    expect(await apply(connA, itemA, { open: 3, ci: null })).toBe(false);
    expect((await row(itemA)).ci_status).toBe("Passing");
    expect(await apply(connA, itemA, { open: 3, ci: "Failing", release: null, repos: "" })).toBe(true);
    expect(await row(itemA)).toMatchObject({ ci_status: "Failing", latest_release: null, repositories: null });
  });
  it("refuses negative counts and a CI word that is not in the list", async () => {
    expect(await errorCode(apply(connA, itemA, { open: -1 }))).toBe("22023");
    expect(await errorCode(apply(connA, itemA, { merged: null }))).toBe("22023");
    expect(await errorCode(apply(connA, itemA, { ci: "Green" }))).toBe("22023");
  });
  it("caps the texts and touches only initiatives linked on that connection", async () => {
    await apply(connA, itemA, { open: 3, ci: "Failing", release: "r".repeat(300), repos: "x".repeat(700) });
    expect(((await row(itemA)).latest_release as string).length).toBe(200);
    expect(((await row(itemA)).repositories as string).length).toBe(500);
    expect(await apply(connA, unlinkedA)).toBe(false);
    expect(await apply(connA, itemB)).toBe(false);
    expect(await apply(connB, itemA)).toBe(false);
    expect(await row(unlinkedA)).toMatchObject({ open_prs: null, ci_status: null });
    expect(await row(itemB)).toMatchObject({ open_prs: null, ci_status: null });
  });
  it("signed-in users cannot call it, write the columns, or read another workspace's values", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.github_apply_extras($1, $2, 1, 1, 'Passing', null, null)", [connA, itemA])))).toBe(DENIED);
    for (const col of ["open_prs", "merged_prs", "ci_status", "latest_release", "repositories"]) {
      expect(await errorCode(db.asUser(creator, (q) => q(`update public.items set ${col} = ${col.endsWith("prs") ? "1" : "'Passing'"} where id = $1`, [itemA]))), col).toBe(DENIED);
    }
    expect(await db.asUser(f.bob, async (q) => (await q("select open_prs from public.items where id = $1", [itemA])).rowCount)).toBe(0);
  });
});
