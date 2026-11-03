import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Children of a linked initiative (issue #67, #71): jira_apply_tree replaces the read-only tree of an initiative, marks the light records of the
// children (they are not new items) and rolls the leaves up into delivery progress. Service role only; audited on the item.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let connA: string;
let connB: string;
let n = 0;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-tree-jira@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

/** An initiative linked to epic KEY-1, plus light records for KEY-2 and KEY-3 (open work read earlier, as new items). */
async function linked(tenant = f.tenantA, conn = connA) {
  const key = `TR${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source) values ($1, $2, 'Epic', $3) returning id", [tenant, p, `Jira issue ${key}`])).rows[0].id as string;
  await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, 'follow')", [tenant, item, conn, `${key}-1`]);
  for (const i of [2, 3]) await db.admin.query("insert into public.jira_issues (tenant_id, connection_id, project_id, site_id, jira_project_key, issue_key, title, status_category, parent_key) values ($1, $2, $3, 'site-1', $4, $5, 'Child', 'new', $6)", [tenant, conn, p, key, `${key}-${i}`, `${key}-1`]);
  return { item, key, epic: `${key}-1`, project: p };
}
const node = (key: string, parent: string, level: 1 | 2, category: string | null, position: number, extra: Record<string, unknown> = {}) =>
  ({ key, id: String(9000 + position), parent, level, position, title: `Issue ${key}`, type: level === 1 ? "Task" : "Sub-task", status: category === "done" ? "Done" : "To Do", category, assignee: "Dana Reyes", url: `https://acme.atlassian.net/browse/${key}`, updated: "2026-11-02T10:00:00Z", ...extra });
const apply = (item: string, nodes: unknown[], total: number, closed: number, pct: number | null, conn = connA, site = "site-1") =>
  db.asService(async (q) => (await q("select public.jira_apply_tree($1, $2, $3, $4::jsonb, $5, $6, $7) as r", [conn, site, item, JSON.stringify(nodes), total, closed, pct])).rows[0].r as Record<string, unknown>, { commit: true });
const treeKeys = async (item: string) => (await db.admin.query("select issue_key from public.item_jira_tree where item_id = $1 order by position", [item])).rows.map((r) => r.issue_key as string);
const rollup = async (item: string) => (await db.admin.query("select issues_total, issues_closed, delivery_progress_pct, status, initiative_status from public.items where id = $1", [item])).rows[0];

describe("jira_apply_tree", () => {
  it("stores children and sub-tasks in order and writes the roll-up on the item", async () => {
    const { item, key, epic } = await linked();
    const r = await apply(item, [node(`${key}-2`, epic, 1, "done", 1), node(`${key}-3`, epic, 1, "new", 2), node(`${key}-4`, `${key}-3`, 2, "done", 3), node(`${key}-5`, `${key}-3`, 2, "new", 4)], 3, 2, 67);
    expect(r).toMatchObject({ nodes: 4, written: 4, removed: 0, rolled_up: true });
    expect(await treeKeys(item)).toEqual([`${key}-2`, `${key}-3`, `${key}-4`, `${key}-5`]);
    expect(await rollup(item)).toMatchObject({ issues_total: 3, issues_closed: 2, delivery_progress_pct: "67.00" });
    const row = (await db.admin.query("select * from public.item_jira_tree where issue_key = $1", [`${key}-4`])).rows[0];
    expect(row).toMatchObject({ level: 2, parent_key: `${key}-3`, assignee: "Dana Reyes", status_category: "done", issue_type: "Sub-task" });
  });
  it("never touches Build Status or Initiative Status: a closed child is progress, not completion", async () => {
    const { item, key, epic } = await linked();
    await db.admin.query("update public.items set initiative_status = 'On hold', status = 'In progress' where id = $1", [item]);
    await apply(item, [node(`${key}-2`, epic, 1, "done", 1)], 1, 1, 100);
    expect(await rollup(item)).toMatchObject({ delivery_progress_pct: "100.00", initiative_status: "On hold", status: "In progress" });
  });
  it("marks the light records of the children so they are not new items, and the counts leave them out", async () => {
    const { item, key, epic, project } = await linked();
    const open = async () => (await db.admin.query("select issue_key from public.jira_issues where project_id = $1 and child_of_item is null order by 1", [project])).rows.map((r) => r.issue_key);
    expect(await open()).toEqual([`${key}-2`, `${key}-3`]);
    await apply(item, [node(`${key}-2`, epic, 1, "new", 1)], 1, 0, 0);
    expect(await open()).toEqual([`${key}-3`]);
    const c = await db.asUser(f.alice, async (q) => (await q("select pull_state, n::int from public.jira_issue_counts() where project_id = $1", [project])).rows);
    expect(c).toEqual([{ pull_state: "not_pulled", n: 1 }]);
    // the child leaves the tree: it is offered again
    await apply(item, [], 0, 0, null);
    expect(await open()).toEqual([`${key}-2`, `${key}-3`]);
  });
  it("leaves an issue that was already pulled in alone", async () => {
    const { item, key, epic } = await linked();
    await db.admin.query("update public.jira_issues set pull_state = 'pulled' where issue_key = $1", [`${key}-2`]);
    await apply(item, [node(`${key}-2`, epic, 1, "new", 1)], 1, 0, 0);
    expect((await db.admin.query("select child_of_item from public.jira_issues where issue_key = $1", [`${key}-2`])).rows[0].child_of_item).toBeNull();
  });
  it("replaces the tree: changed rows update, gone rows are removed, an identical tree writes nothing and adds no audit rows", async () => {
    const { item, key, epic } = await linked();
    const t1 = [node(`${key}-2`, epic, 1, "new", 1), node(`${key}-3`, epic, 1, "new", 2)];
    await apply(item, t1, 2, 0, 0);
    const audit = async () => (await db.admin.query("select count(*)::int as n from public.audit_log where entity_id = $1", [item])).rows[0].n as number;
    const before = await audit();
    expect(await apply(item, t1, 2, 0, 0)).toMatchObject({ written: 0, removed: 0, rolled_up: false });
    expect(await audit()).toBe(before);
    const r = await apply(item, [node(`${key}-2`, epic, 1, "done", 1, { status: "Done" })], 1, 1, 100);
    expect(r).toMatchObject({ written: 1, removed: 1, rolled_up: true });
    expect(await treeKeys(item)).toEqual([`${key}-2`]);
    expect(await rollup(item)).toMatchObject({ issues_total: 1, issues_closed: 1, delivery_progress_pct: "100.00" });
  });
  it("audits the roll-up with source system, no actor, old and new", async () => {
    const { item, key, epic } = await linked();
    await apply(item, [node(`${key}-2`, epic, 1, "new", 1)], 1, 0, 0);
    await apply(item, [node(`${key}-2`, epic, 1, "done", 1)], 1, 1, 100);
    const a = (await db.admin.query("select old, new, via, actor_id from public.audit_log where entity = 'items' and entity_id = $1 and field = 'issues_closed' and old = to_jsonb(0)", [item])).rows;
    expect(a).toEqual([{ old: 0, new: 1, via: "system", actor_id: null }]);
  });
  it("a tree that stays empty does not write zeros over an empty roll-up", async () => {
    const { item } = await linked();
    expect(await apply(item, [], 0, 0, null)).toMatchObject({ rolled_up: false });
    expect(await rollup(item)).toMatchObject({ issues_total: null, issues_closed: null, delivery_progress_pct: null });
  });
  it("skips malformed nodes (bad key, level, category, address) and the linked issue itself", async () => {
    const { item, key, epic } = await linked();
    await apply(item, [node("nope", epic, 1, "new", 1), node(`${key}-2`, epic, 3 as 1, "new", 2), node(`${key}-3`, epic, 1, "weird", 3), node(`${key}-4`, epic, 1, "new", 4, { url: "javascript:alert(1)" }), node(epic, epic, 1, "new", 5), node(`${key}-6`, epic, 1, "new", 6)], 1, 0, 0);
    expect(await treeKeys(item)).toEqual([`${key}-6`]);
  });
  it("refuses counts that do not add up and more than 500 nodes", async () => {
    const { item } = await linked();
    await expect(apply(item, [], 1, 2, 50)).rejects.toThrow(/do not add up/);
    await expect(apply(item, [], 1, 0, 150)).rejects.toThrow(/do not add up/);
    await expect(apply(item, Array.from({ length: 501 }, () => ({})), 0, 0, null)).rejects.toThrow(/Up to 500/);
  });
  it("is service-role only", async () => {
    const { item } = await linked();
    expect(await errorCode(db.asUser(creator, (q) => q("select public.jira_apply_tree($1, 'site-1', $2, '[]'::jsonb, 0, 0, null)", [connA, item]), { commit: true }))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set issues_total = 99 where id = $1", [item])))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_jira_tree (tenant_id, item_id, issue_key, parent_key, level, title) values ($1, $2, 'AB-9', 'AB-1', 1, 'x')", [f.tenantA, item])))).toBe(DENIED);
  });
  it("two tenants: another workspace's connection or site cannot reach the initiative, and its members cannot read the tree", async () => {
    const a = await linked(f.tenantA, connA);
    await apply(a.item, [node(`${a.key}-2`, a.epic, 1, "new", 1)], 1, 0, 0);
    await expect(apply(a.item, [], 0, 0, null, connB)).rejects.toThrow(/not linked/);
    await expect(apply(a.item, [], 0, 0, null, connA, "other-site")).rejects.toThrow(/not linked/);
    expect(await treeKeys(a.item)).toHaveLength(1);
    const asBob = await db.asUser(f.bob, async (q) => (await q("select issue_key from public.item_jira_tree where item_id = $1", [a.item])).rows);
    expect(asBob).toEqual([]);
    const asAlice = await db.asUser(f.alice, async (q) => (await q("select issue_key from public.item_jira_tree where item_id = $1", [a.item])).rows);
    expect(asAlice).toHaveLength(1);
  });
  it("selects the columns the app reads (a fake database hides a column that does not exist)", async () => {
    await db.admin.query("select id, tenant_id, item_id, issue_key, parent_key, level, position, title, issue_type, status, status_category, assignee, html_url, jira_updated_at from public.item_jira_tree limit 1");
    await db.admin.query("select child_of_item from public.jira_issues limit 1");
    await db.admin.query("select issues_total, issues_closed, delivery_progress_pct from public.items limit 1");
  });
});
