import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, itemA: string, itemA2: string, itemB: string, unlinkedA: string, connA: string, connB: string;
const DENIED = "42501";

const apply = (conn: string, rows: unknown[]) => db.asService(async (q) => (await q("select public.github_apply_board_status($1, $2::jsonb) as n", [conn, JSON.stringify(rows)])).rows[0].n as number, { commit: true });
const status = async (id: string) => (await db.admin.query("select gh_project_status as s from public.items where id = $1", [id])).rows[0].s as string | null;
const link = async (id: string) => (await db.admin.query("select project_item_id as p from public.item_github_links where item_id = $1", [id])).rows[0].p as string | null;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-delivery@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await db.admin.query("delete from public.item_github_links");
  const a = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 3", [f.tenantA]);
  connA = a.rows[0].conn;
  const items = (await db.admin.query("select id from public.items where tenant_id = $1 order by stack_rank limit 3", [f.tenantA])).rows.map((r) => r.id as string);
  [itemA, itemA2, unlinkedA] = items;
  const b = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantB]);
  [itemB, connB] = [b.rows[0].item, b.rows[0].conn];
  for (const [t, i, c, n] of [[f.tenantA, itemA, connA, 1], [f.tenantA, itemA2, connA, 2], [f.tenantB, itemB, connB, 3]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', 'push')", [t, i, c, n, 9100 + n]);
  }
});
afterAll(async () => { await db.close(); });

describe("Delivery Status is written by the server only, and only when it changed", () => {
  it("sets the board status and the board item, audited as GitHub", async () => {
    expect(await apply(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1" }, { item_id: itemA2, status: "In progress", board_item_id: "PVTI_2" }])).toBe(2);
    expect(await status(itemA)).toBe("Ready");
    expect(await link(itemA)).toBe("PVTI_1");
    const a = (await db.admin.query("select new #>> '{}' as v, actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'gh_project_status' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ v: "Ready", actor_id: null, via: "GitHub webhook" });
  });
  it("writes nothing when the status is the same (the same answer twice changes no row)", async () => {
    expect(await apply(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1" }])).toBe(0);
    const before = (await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'items' and entity_id = $1 and field = 'gh_project_status'", [itemA])).rows[0].n;
    await apply(connA, [{ item_id: itemA, status: "Ready", board_item_id: "PVTI_1" }]);
    expect((await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'items' and entity_id = $1 and field = 'gh_project_status'", [itemA])).rows[0].n).toBe(before);
  });
  it("a changed or emptied status is applied", async () => {
    await apply(connA, [{ item_id: itemA, status: "Done", board_item_id: "PVTI_1" }]);
    expect(await status(itemA)).toBe("Done");
    await apply(connA, [{ item_id: itemA, status: null, board_item_id: null }]);
    expect(await status(itemA)).toBeNull();
    expect(await link(itemA)).toBe("PVTI_1"); // a missing board item never erases what is known
  });
  it("only initiatives linked on this connection are touched", async () => {
    expect(await apply(connA, [{ item_id: unlinkedA, status: "Ready", board_item_id: "X" }, { item_id: itemB, status: "Ready", board_item_id: "Y" }])).toBe(0);
    expect(await status(unlinkedA)).toBeNull();
    expect(await status(itemB)).toBeNull();
    expect(await link(itemB)).toBeNull();
  });
  it("is capped at 100 characters, and unknown connections are refused", async () => {
    await apply(connA, [{ item_id: itemA2, status: "x".repeat(150), board_item_id: null }]);
    expect(((await status(itemA2)) ?? "").length).toBe(100);
    expect(await errorCode(apply("00000000-0000-0000-0000-000000000000", []))).toBe("22023");
  });
  it("signed-in users cannot call it or write the column", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.github_apply_board_status($1, '[]'::jsonb)", [connA])))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set gh_project_status = 'Done' where id = $1", [itemA])))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select gh_project_status from public.items where id = $1", [itemA])).rowCount)).toBe(0);
  });
});
