import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, itemA: string, unlinkedA: string, itemB: string, connA: string, connB: string;
const DENIED = "42501";

const counts = (conn: string, item: string, blocked: number | null, stale: number | null) =>
  db.asService(async (q) => (await q("select public.github_apply_tree_counts($1, $2, $3, $4) as r", [conn, item, blocked, stale])).rows[0].r as boolean, { commit: true });
const board = (conn: string, rows: unknown[]) => db.asService(async (q) => (await q("select public.github_apply_board_status($1, $2::jsonb) as n", [conn, JSON.stringify(rows)])).rows[0].n as number, { commit: true });
const row = async (id: string) => (await db.admin.query("select blocked_issues, stale_issues, gh_iteration, gh_target_date::text as gh_target_date, gh_project_status from public.items where id = $1", [id])).rows[0];
const auditCount = async (id: string, field: string) => (await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'items' and entity_id = $1 and field = $2", [id, field])).rows[0].n as number;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-measures@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await db.admin.query("delete from public.item_github_links");
  const ids = (await db.admin.query("select id from public.items where tenant_id = $1 order by stack_rank limit 2", [f.tenantA])).rows.map((r) => r.id as string);
  [itemA, unlinkedA] = ids;
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  connB = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  for (const [t, i, c, n] of [[f.tenantA, itemA, connA, 1], [f.tenantB, itemB, connB, 2]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', 'push')", [t, i, c, n, 9300 + n]);
  }
});
afterAll(async () => { await db.close(); });

describe("blocked and stale issue counts are written by the server only, and only when they changed", () => {
  it("stores both counts, audited as GitHub", async () => {
    expect(await counts(connA, itemA, 2, 5)).toBe(true);
    expect(await row(itemA)).toMatchObject({ blocked_issues: 2, stale_issues: 5 });
    const a = (await db.admin.query("select new #>> '{}' as v, actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'stale_issues' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ v: "5", actor_id: null, via: "GitHub webhook" });
  });
  it("writes nothing when the numbers are the same, and a changed number is applied", async () => {
    const before = await auditCount(itemA, "blocked_issues");
    expect(await counts(connA, itemA, 2, 5)).toBe(false);
    expect(await auditCount(itemA, "blocked_issues")).toBe(before);
    expect(await counts(connA, itemA, 0, 5)).toBe(true);
    expect(await row(itemA)).toMatchObject({ blocked_issues: 0, stale_issues: 5 });
  });
  it("refuses negative or missing counts", async () => {
    expect(await errorCode(counts(connA, itemA, -1, 0))).toBe("22023");
    expect(await errorCode(counts(connA, itemA, 0, null))).toBe("22023");
  });
  it("touches only initiatives linked on that connection: another workspace's connection or an unlinked item changes nothing", async () => {
    expect(await counts(connA, unlinkedA, 9, 9)).toBe(false);
    expect(await counts(connA, itemB, 9, 9)).toBe(false);
    expect(await counts(connB, itemA, 9, 9)).toBe(false);
    expect(await row(unlinkedA)).toMatchObject({ blocked_issues: null, stale_issues: null });
    expect(await row(itemB)).toMatchObject({ blocked_issues: null, stale_issues: null });
    expect(await row(itemA)).toMatchObject({ blocked_issues: 0, stale_issues: 5 });
  });
  it("signed-in users cannot call it, write the columns, or read another workspace's values", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.github_apply_tree_counts($1, $2, 1, 1)", [connA, itemA])))).toBe(DENIED);
    for (const col of ["blocked_issues", "stale_issues", "gh_iteration", "gh_target_date"]) {
      expect(await errorCode(db.asUser(creator, (q) => q(`update public.items set ${col} = ${col === "gh_iteration" ? "'x'" : col === "gh_target_date" ? "'2026-01-01'" : "1"} where id = $1`, [itemA]))), col).toBe(DENIED);
    }
    expect(await db.asUser(f.bob, async (q) => (await q("select blocked_issues from public.items where id = $1", [itemA])).rowCount)).toBe(0);
  });
});

describe("Delivery Status also carries the board's iteration and target date", () => {
  it("sets iteration and date with the status, audited as GitHub", async () => {
    expect(await board(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1", iteration: "Sprint 4", target_date: "2026-12-15" }])).toBe(1);
    expect(await row(itemA)).toMatchObject({ gh_project_status: "Ready", gh_iteration: "Sprint 4", gh_target_date: "2026-12-15" });
    const a = (await db.admin.query("select new #>> '{}' as v, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'gh_iteration' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ v: "Sprint 4", via: "GitHub webhook" });
  });
  it("a changed iteration alone is applied, the same values change no row, and emptied values clear them", async () => {
    expect(await board(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1", iteration: "Sprint 5", target_date: "2026-12-15" }])).toBe(1);
    expect(await board(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1", iteration: "Sprint 5", target_date: "2026-12-15" }])).toBe(0);
    expect(await board(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1", iteration: null, target_date: null }])).toBe(1);
    expect(await row(itemA)).toMatchObject({ gh_iteration: null, gh_target_date: null, gh_project_status: "Ready" });
  });
  it("caps the iteration at 100 characters and refuses nothing it cannot store; other workspaces' initiatives are untouched", async () => {
    await board(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1", iteration: "s".repeat(150), target_date: null }]);
    expect(((await row(itemA)).gh_iteration as string).length).toBe(100);
    expect(await board(connA, [{ item_id: itemB, status: "Ready", board_item_id: "X", iteration: "Sprint 9", target_date: "2026-01-01" }])).toBe(0);
    expect(await row(itemB)).toMatchObject({ gh_iteration: null, gh_target_date: null });
  });
});
