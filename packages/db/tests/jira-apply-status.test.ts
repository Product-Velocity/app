import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Refresh of linked initiatives from Jira (issue #67, #71): jira_apply_statuses applies a read of an issue to its linked initiative.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let connA: string;
let connB: string;
let n = 0;
const DENIED = "42501";
type Result = { key: string; item_id: string; stale: boolean; changes: Record<string, [string | null, string | null]> }[];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-as@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

/** An initiative linked to Jira issue KEY-1 with the status and category it was pulled in with. */
async function linked(tenant = f.tenantA, conn = connA, category: string | null = "new", status = "To Do", updated = "2026-11-01T10:00:00Z") {
  const key = `AS${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source, status) values ($1, $2, 'Linked', $3, $4) returning id", [tenant, p, `Jira issue ${key}-1`, category === "new" ? "Not started" : category === "indeterminate" ? "In progress" : category === "done" ? "Done" : null])).rows[0].id as string;
  await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode, jira_status, jira_status_category, jira_updated_at) values ($1, $2, $3, 'site-1', $4, 'follow', $5, $6, $7)", [tenant, item, conn, `${key}-1`, status, category, updated]);
  return { item, key: `${key}-1` };
}
const apply = (conn: string, rows: unknown[], site = "site-1") => db.asService(async (q) => (await q("select public.jira_apply_statuses($1, $2, $3::jsonb) as r", [conn, site, JSON.stringify(rows)])).rows[0].r as Result, { commit: true });
const row = async (item: string) => (await db.admin.query("select i.status, i.initiative_status, i.status_changed_at, i.last_synced_at, l.jira_status, l.jira_status_category, l.jira_updated_at from public.items i join public.item_jira_links l on l.item_id = i.id where i.id = $1", [item])).rows[0];

describe("jira_apply_statuses", () => {
  it("a status category change moves Build Status, updates the link and returns what changed", async () => {
    const { item, key } = await linked();
    const r = await apply(connA, [{ key, status: "In Review", category: "indeterminate", updated: "2026-11-02T10:00:00Z" }]);
    expect(r).toEqual([{ key, item_id: item, stale: false, changes: { status: ["Not started", "In progress"], jira_status: ["To Do", "In Review"] } }]);
    expect(await row(item)).toMatchObject({ status: "In progress", jira_status: "In Review", jira_status_category: "indeterminate" });
    expect((await row(item)).status_changed_at).not.toBeNull();
    expect((await row(item)).last_synced_at).not.toBeNull();
  });
  it("done = Done, and a reopened issue moves Build Status back", async () => {
    const { item, key } = await linked(f.tenantA, connA, "indeterminate", "In Progress");
    await apply(connA, [{ key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }]);
    expect((await row(item)).status).toBe("Done");
    await apply(connA, [{ key, status: "To Do", category: "new", updated: "2026-11-03T10:00:00Z" }]);
    expect((await row(item)).status).toBe("Not started");
  });
  it("never sets Initiative Status", async () => {
    const { item, key } = await linked();
    await db.admin.query("update public.items set initiative_status = 'On hold' where id = $1", [item]);
    await apply(connA, [{ key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }]);
    expect(await row(item)).toMatchObject({ status: "Done", initiative_status: "On hold" });
  });
  it("compares before writing: an answer that says nothing new writes nothing and is not audited", async () => {
    const { item, key } = await linked();
    const same = [{ key, status: "To Do", category: "new", updated: "2026-11-01T10:00:00Z" }];
    const before = (await db.admin.query("select count(*)::int as n from public.audit_log where entity_id in ($1, (select id from public.item_jira_links where item_id = $1))", [item])).rows[0].n as number;
    const r = await apply(connA, same);
    expect(r[0]).toMatchObject({ stale: false, changes: {} });
    const after = (await db.admin.query("select count(*)::int as n from public.audit_log where entity_id in ($1, (select id from public.item_jira_links where item_id = $1))", [item])).rows[0].n as number;
    expect(after).toBe(before);
  });
  it("ignores an answer older than what is known", async () => {
    const { item, key } = await linked(f.tenantA, connA, "done", "Done", "2026-11-02T10:00:00Z");
    const r = await apply(connA, [{ key, status: "To Do", category: "new", updated: "2026-11-01T09:00:00Z" }]);
    expect(r[0]).toMatchObject({ stale: true, changes: {} });
    expect(await row(item)).toMatchObject({ status: "Done", jira_status: "Done", jira_status_category: "done" });
  });
  it("a read without a category keeps what is known", async () => {
    const { item, key } = await linked(f.tenantA, connA, "indeterminate", "In Progress");
    await apply(connA, [{ key, status: "Odd", category: null, updated: "2026-11-02T10:00:00Z" }]);
    expect(await row(item)).toMatchObject({ status: "In progress", jira_status: "In Progress" });
  });
  it("a trashed initiative keeps its link current but its status is not changed", async () => {
    const { item, key } = await linked();
    await db.admin.query("update public.items set deleted_at = now() where id = $1", [item]);
    await apply(connA, [{ key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }]);
    expect(await row(item)).toMatchObject({ status: "Not started", jira_status_category: "done" });
  });
  it("audits both writes with source system, old and new", async () => {
    const { item, key } = await linked();
    await apply(connA, [{ key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }]);
    const a = (await db.admin.query("select entity, field, old, new, via, actor_id from public.audit_log where (entity = 'items' and entity_id = $1 and field = 'status' and old is not null) or (entity = 'item_jira_links' and field = 'jira_status_category' and old is not null and entity_id = (select id from public.item_jira_links where item_id = $1)) order by entity", [item])).rows;
    expect(a).toHaveLength(2);
    const items = a.find((x) => x.entity === "items")!;
    expect(items).toMatchObject({ old: "Not started", new: "Done", via: "system", actor_id: null });
    expect(a.find((x) => x.entity === "item_jira_links")).toMatchObject({ old: "new", new: "done", via: "system" });
  });
  it("only touches links of its own connection and site (two tenants)", async () => {
    const a = await linked(f.tenantA, connA);
    const b = await linked(f.tenantB, connB);
    const r = await apply(connB, [{ key: a.key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }, { key: b.key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }]);
    expect(r.map((x) => x.key)).toEqual([b.key]);
    expect((await row(a.item)).status).toBe("Not started");
    expect((await row(b.item)).status).toBe("Done");
    expect(await apply(connA, [{ key: a.key, status: "Done", category: "done", updated: "2026-11-02T10:00:00Z" }], "other-site")).toEqual([]);
  });
  it("skips bad keys and categories, refuses more than 500 rows", async () => {
    const { item, key } = await linked();
    expect(await apply(connA, [{ key: "nope", category: "done" }, { key, status: "x", category: "weird" }])).toEqual([]);
    expect((await row(item)).status).toBe("Not started");
    expect(await errorCode(db.asService((q) => q("select public.jira_apply_statuses($1, 'site-1', $2::jsonb)", [connA, JSON.stringify(Array.from({ length: 501 }, () => ({ key: "AB-1" })))]), { commit: true }))).toBe("22023");
  });
  it("signed-in people, including a creator, cannot call it", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.jira_apply_statuses($1, 'site-1', '[]'::jsonb)", [connA]), { commit: true }))).toBe(DENIED);
  });
});
