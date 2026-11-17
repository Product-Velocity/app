import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Jira Initiative level (issue #431): jira_apply_link_level stores the hierarchy level of the linked issue and, above Epic only, applies the Build Status derived from the epics.
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
  creator = await createUser(db, "creator-ll@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

async function linked(tenant = f.tenantA, conn = connA, status: string | null = "Not started") {
  const key = `LL${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source, status) values ($1, $2, 'Linked', $3, $4) returning id", [tenant, p, `Jira issue ${key}-1`, status])).rows[0].id as string;
  await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode, jira_status, jira_status_category, jira_updated_at) values ($1, $2, $3, 'site-1', $4, 'follow', 'Idea', 'new', '2026-11-01T10:00:00Z')", [tenant, item, conn, `${key}-1`]);
  return { item };
}
const apply = (conn: string, item: string, level: number, category: string | null, site = "site-1") =>
  db.asService(async (q) => (await q("select public.jira_apply_link_level($1, $2, $3, $4::smallint, $5) as r", [conn, site, item, level, category])).rows[0].r as Record<string, [unknown, unknown]>, { commit: true });
const row = async (item: string) => (await db.admin.query("select i.status, i.initiative_status, l.issue_level, l.jira_status, l.jira_status_category from public.items i join public.item_jira_links l on l.item_id = i.id where i.id = $1", [item])).rows[0];

describe("jira_apply_link_level", () => {
  it("above Epic: stores the level and applies the Build Status derived from the epics", async () => {
    const { item } = await linked();
    expect(await apply(connA, item, 2, "indeterminate")).toEqual({ issue_level: [null, 2], status: ["Not started", "In progress"] });
    expect(await row(item)).toMatchObject({ status: "In progress", issue_level: 2 });
    expect(await apply(connA, item, 2, "done")).toEqual({ status: ["In progress", "Done"] });
    expect((await row(item)).status).toBe("Done");
  });
  it("never touches Initiative Status or the link's own Jira status", async () => {
    const { item } = await linked();
    await db.admin.query("update public.items set initiative_status = 'On hold' where id = $1", [item]);
    await apply(connA, item, 3, "done");
    expect(await row(item)).toMatchObject({ status: "Done", initiative_status: "On hold", jira_status: "Idea", jira_status_category: "new" });
  });
  it("at Epic level or below only the level is stored: Build Status stays with jira_apply_statuses", async () => {
    const { item } = await linked();
    expect(await apply(connA, item, 1, "done")).toEqual({ issue_level: [null, 1] });
    expect((await row(item)).status).toBe("Not started");
    expect(await apply(connA, item, 0, null)).toEqual({ issue_level: [1, 0] });
  });
  it("no category above Epic (no epics): the level is stored and Build Status is left as it is", async () => {
    const { item } = await linked(f.tenantA, connA, "In progress");
    expect(await apply(connA, item, 2, null)).toEqual({ issue_level: [null, 2] });
    expect((await row(item)).status).toBe("In progress");
  });
  it("compares before writing: the same answer changes nothing and adds no audit rows", async () => {
    const { item } = await linked();
    await apply(connA, item, 2, "indeterminate");
    const count = async () => (await db.admin.query("select count(*)::int as n from public.audit_log where entity_id in ($1, (select id from public.item_jira_links where item_id = $1))", [item])).rows[0].n as number;
    const before = await count();
    expect(await apply(connA, item, 2, "indeterminate")).toEqual({});
    expect(await count()).toBe(before);
  });
  it("audits the Build Status change with source system, old and new", async () => {
    const { item } = await linked();
    await apply(connA, item, 2, "done");
    const a = (await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'items' and entity_id = $1 and field = 'status' and old is not null", [item])).rows;
    expect(a).toEqual([{ field: "status", old: "Not started", new: "Done", via: "system", actor_id: null }]);
  });
  it("a trashed initiative gets its level but not a new Build Status", async () => {
    const { item } = await linked();
    await db.admin.query("update public.items set deleted_at = now() where id = $1", [item]);
    await apply(connA, item, 2, "done");
    expect(await row(item)).toMatchObject({ status: "Not started", issue_level: 2 });
  });
  it("refuses another tenant's connection, another site, bad levels and bad categories", async () => {
    const a = await linked(f.tenantA, connA);
    expect(await errorCode(apply(connB, a.item, 2, "done"))).toBe("22023");
    expect(await errorCode(apply(connA, a.item, 2, "done", "other-site"))).toBe("22023");
    expect(await errorCode(apply(connA, a.item, 99, "done"))).toBe("22023");
    expect(await errorCode(apply(connA, a.item, 2, "weird"))).toBe("22023");
    expect((await row(a.item)).status).toBe("Not started");
  });
  it("signed-in people, including a creator, cannot call it", async () => {
    const { item } = await linked();
    expect(await errorCode(db.asUser(creator, (q) => q("select public.jira_apply_link_level($1, 'site-1', $2, 2::smallint, 'done')", [connA, item]), { commit: true }))).toBe(DENIED);
  });
});
