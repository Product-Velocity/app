import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let itemA: string, connA: string, itemB: string, connB: string;
const DENIED = "42501";
const BAD = "22023";

const node = (number: number, level: 1 | 2, parent: number | null) =>
  ({ repo: "Acme/App", number, id: 5000 + number, parent, level, title: `Issue ${number}`, state: "open", reason: null, closed_at: null, assignees: [], created_by: "engineer" });
const apply = (conn: string, item: string, nodes: unknown[]) =>
  db.asService((q) => q("select public.github_apply_tree($1, $2, $3::jsonb, $4, 0, null)", [conn, item, JSON.stringify(nodes), nodes.length]), { commit: true });
const record = (conn: string, item: string, board: string, nodes: unknown[]) =>
  db.asService(async (q) => (await q("select public.github_record_board_items($1, $2, $3, $4::jsonb) as n", [conn, item, board, JSON.stringify(nodes)])).rows[0].n as number, { commit: true });
const rows = async (item: string) => (await db.admin.query("select issue_number, board_id, board_item_id from public.item_issue_tree where item_id = $1 order by issue_number", [item])).rows;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  await db.admin.query("delete from public.item_issue_tree");
  await db.admin.query("delete from public.item_github_links");
  const a = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantA]);
  const b = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantB]);
  [itemA, connA, itemB, connB] = [a.rows[0].item, a.rows[0].conn, b.rows[0].item, b.rows[0].conn];
  for (const [t, i, c, n] of [[f.tenantA, itemA, connA, 34], [f.tenantB, itemB, connB, 7]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', 'push')", [t, i, c, n, 9000 + n]);
  }
  await apply(connA, itemA, [node(40, 1, null), node(41, 2, 40), node(42, 2, 40)]);
  await apply(connB, itemB, [node(70, 1, null)]);
});
afterAll(async () => { await db.close(); });

describe("which board each child issue is on", () => {
  it("the server records the board item of children; others stay untouched", async () => {
    expect(await record(connA, itemA, "PVT_1", [{ repo: "Acme/App", number: 40, board_item_id: "PVTI_40" }, { repo: "Acme/App", number: 41, board_item_id: "PVTI_41" }])).toBe(2);
    expect(await rows(itemA)).toEqual([
      { issue_number: 40, board_id: "PVT_1", board_item_id: "PVTI_40" }, { issue_number: 41, board_id: "PVT_1", board_item_id: "PVTI_41" }, { issue_number: 42, board_id: null, board_item_id: null },
    ]);
  });
  it("a refreshed tree keeps what is recorded", async () => {
    await apply(connA, itemA, [node(40, 1, null), node(41, 2, 40), node(42, 2, 40)]);
    expect((await rows(itemA)).filter((r) => r.board_id === "PVT_1")).toHaveLength(2);
  });
  it("a different board overwrites the mark, so children of the old board are added to the new one", async () => {
    await record(connA, itemA, "PVT_2", [{ repo: "Acme/App", number: 42, board_item_id: "PVTI_X" }]);
    expect((await rows(itemA)).find((r) => r.issue_number === 42)).toMatchObject({ board_id: "PVT_2" });
  });
  it("a connection of another workspace cannot record children of this initiative", async () => {
    expect(await errorCode(record(connB, itemA, "PVT_1", [{ repo: "Acme/App", number: 40, board_item_id: "EVIL" }]))).toBe(BAD);
    expect((await rows(itemA)).some((r) => r.board_item_id === "EVIL")).toBe(false);
    expect((await rows(itemB))[0]).toMatchObject({ board_id: null });
  });
  it("signed-in users cannot call it, and nothing in another workspace changes", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.github_record_board_items($1, $2, 'x', '[]'::jsonb)", [connA, itemA])))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.item_issue_tree set board_id = 'x' where item_id = $1", [itemA])))).toBe(DENIED);
  });
});
