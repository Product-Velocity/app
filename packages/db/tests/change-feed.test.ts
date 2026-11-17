import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Changes report (issue #472): change_feed returns what changed on the initiatives of a workspace in a period, to every member.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;
let connA: string;
let n = 0;
const DENIED = "42501";
const WIDE: [string, string] = ["2000-01-01", "2999-01-01"];
type Row = { id: number; item_id: string; entity: string; field: string; old: unknown; new: unknown; actor_id: string | null; via: string };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-cf@example.test");
  viewer = await createUser(db, "viewer-cf@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

const feed = (user: string, tenant = f.tenantA, range: [string, string] = WIDE) =>
  db.asUser(user, async (q) => (await q("select * from public.change_feed($1, $2, $3)", [tenant, range[0], range[1]])).rows as Row[]);
const item = async () => (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Feed test', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;

describe("change_feed", () => {
  it("returns phase, status, health and build status changes with actor and source, and nothing else, to a viewer too", async () => {
    const id = await item();
    await db.asUser(creator, (q) => q("update public.items set health = 'At Risk', effort = 'M', moscow = 'Must' where id = $1", [id]), { commit: true, via: "UI" });
    const rows = (await feed(viewer)).filter((r) => r.item_id === id);
    expect(rows.find((r) => r.field === "health")).toMatchObject({ entity: "items", new: "At Risk", actor_id: creator, via: "UI" });
    expect(rows.map((r) => r.field)).not.toContain("effort");
    expect(rows.map((r) => r.field)).not.toContain("moscow");
  });

  it("maps the status of a linked Jira issue to its initiative, and leaves out the first value", async () => {
    const id = await item();
    n++;
    await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode, jira_status, jira_status_category, jira_updated_at) values ($1, $2, $3, 'site-1', $4, 'follow', 'To Do', 'new', now())", [f.tenantA, id, connA, `CF${n}-1`]);
    await db.admin.query("update public.item_jira_links set jira_status = 'Project Closed', jira_status_category = 'done' where item_id = $1", [id]);
    const rows = (await feed(creator)).filter((r) => r.item_id === id && r.entity === "item_jira_links");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "jira_status", old: "To Do", new: "Project Closed" });
  });

  it("respects the period", async () => {
    const id = await item();
    await db.asUser(creator, (q) => q("update public.items set health = 'Delayed' where id = $1", [id]), { commit: true, via: "UI" });
    expect((await feed(creator, f.tenantA, ["2999-01-01", "2999-01-02"])).some((r) => r.item_id === id)).toBe(false);
    expect((await feed(creator, f.tenantA, WIDE)).some((r) => r.item_id === id)).toBe(true);
  });

  it("refuses another workspace and anonymous callers, and never shows another workspace's changes", async () => {
    const id = await item();
    await db.asUser(creator, (q) => q("update public.items set health = 'Blocked' where id = $1", [id]), { commit: true, via: "UI" });
    expect(await errorCode(feed(f.bob, f.tenantA))).toBe(DENIED);
    expect(await errorCode(db.asAnon((q) => q("select * from public.change_feed($1, $2, $3)", [f.tenantA, ...WIDE])))).toBe(DENIED);
    expect((await feed(f.bob, f.tenantB)).some((r) => r.item_id === id)).toBe(false);
  });
});
