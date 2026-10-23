import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, itemA: string, connA: string, itemB: string;
const DENIED = "42501";

const node = (number: number, level: 1 | 2, parent: number | null, state = "open", extra: Record<string, unknown> = {}) =>
  ({ repo: "Acme/App", number, id: 5000 + number, parent, level, title: `Issue ${number}`, state, reason: null, closed_at: state === "closed" ? "2026-10-23T10:00:00Z" : null, assignees: ["dev1"], created_by: "engineer", ...extra });
const applyTree = (nodes: unknown[], total: number, closed: number, pct: number | null, item = itemA) =>
  db.asService((q) => q("select public.github_apply_tree($1, $2, $3::jsonb, $4, $5, $6)", [connA, item, JSON.stringify(nodes), total, closed, pct]), { commit: true });
const row = async () => (await db.admin.query("select * from public.items where id = $1", [itemA])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-tree@example.test");
  viewer = await createUser(db, "viewer-tree@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await db.admin.query("delete from public.item_issue_tree");
  await db.admin.query("delete from public.item_github_links");
  const a = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantA]);
  itemA = a.rows[0].item; connA = a.rows[0].conn;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 and id <> $2 limit 1", [f.tenantA, itemA])).rows[0].id;
  await db.admin.query("update public.items set breakdown_status = null, breakdown_route = null, planned_scope = null where id = $1", [itemA]);
  await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode, gh_state, gh_last_activity) values ($1, $2, $3, 'Acme/App', 34, 9034, 'https://github.com/Acme/App/issues/34', 'synced', 'push', 'open', '2026-10-23T09:00:00Z')", [f.tenantA, itemA, connA]);
});
afterAll(async () => {
  await db.close();
});

describe("the issue tree feeds delivery columns", () => {
  it("stores epics and tasks and counts them; a pushed tracking issue starts the Traditional route", async () => {
    await applyTree([node(40, 1, null), node(41, 2, 40, "closed"), node(42, 2, 40)], 2, 1, 50);
    expect((await db.admin.query("select count(*)::int as n from public.item_issue_tree where item_id = $1", [itemA])).rows[0].n).toBe(3);
    expect(await row()).toMatchObject({ issues_total: 2, issues_closed: 1, delivery_progress_pct: "50.00", gh_state: "Open", breakdown_route: "Traditional", breakdown_status: "Awaiting engineering", scope_added: null });
  });
  it("replaying the same tree changes nothing and removed sub-issues leave the cache", async () => {
    await applyTree([node(40, 1, null), node(41, 2, 40, "closed"), node(42, 2, 40)], 2, 1, 50);
    await applyTree([node(40, 1, null), node(41, 2, 40, "closed")], 1, 1, 100);
    expect((await db.admin.query("select issue_number from public.item_issue_tree where item_id = $1 order by 1", [itemA])).rows.map((r) => r.issue_number)).toEqual([40, 41]);
    expect(await row()).toMatchObject({ issues_total: 1, issues_closed: 1 });
  });
  it("a viewer cannot complete the breakdown; a creator can, which freezes Planned Scope", async () => {
    expect(await errorCode(db.asUser(viewer, (q) => q("select public.item_complete_breakdown($1)", [itemA])))).toBe(DENIED);
    await db.asUser(creator, (q) => q("select public.item_complete_breakdown($1)", [itemA]), { commit: true });
    expect(await row()).toMatchObject({ breakdown_status: "Complete", planned_scope: 1, scope_added: 0 });
  });
  it("sub-issues added after Complete count as Scope Added, and are audited with the webhook source", async () => {
    await applyTree([node(40, 1, null), node(41, 2, 40, "closed"), node(43, 2, 40), node(44, 2, 40)], 3, 1, 33);
    expect(await row()).toMatchObject({ planned_scope: 1, scope_added: 2, issues_total: 3 });
    const a = await db.admin.query("select via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'issues_total' order by at desc limit 1", [itemA]);
    expect(a.rows[0].via).toBe("GitHub webhook");
  });
  it("is service-role only and refuses an item that has no link", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.github_apply_tree($1, $2, '[]'::jsonb, 0, 0, null)", [connA, itemA])))).toBe(DENIED);
    await expect(applyTree([], 0, 0, null, itemB)).rejects.toThrow(/not linked/);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set issues_total = 99 where id = $1", [itemA])))).toBe(DENIED);
  });
});
