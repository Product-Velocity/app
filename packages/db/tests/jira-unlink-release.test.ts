import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Unlinking a Jira project with Jira-linked initiatives: keep or delete them, Build Status cleared, the marker label re-adopts (2026-11-18).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string, bob: string;
let conn: string, connB: string;
let n = 0;
const DENIED = "42501";
const marker = (itemId: string, prefix = "pm:item/") => `${prefix}${createHash("sha256").update(`pv-jira-marker:${itemId}`).digest("hex").slice(0, 16)}`;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-ur@example.test");
  service = await createUser(db, "service-ur@example.test");
  bob = f.bob;
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  conn = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

/** A Jira-linked project with two initiatives that have a Jira link, a tree row and a Build Status. */
async function linkedProject(tenant = f.tenantA, connection = conn) {
  const key = `UR${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, $2, 'jira') returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 'site-1', $4, $5, 'x', '1', 'Epic')", [tenant, p, connection, String(2000 + n), key]);
  const items: string[] = [];
  for (const i of [1, 2]) {
    const id = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, moscow, value_12m) values ($1, $2, $3, 'Must', 555) returning id", [tenant, p, `Init ${key}-${i}`])).rows[0].id as string;
    await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, 'push')", [tenant, id, connection, `${key}-${i}`]);
    await db.admin.query("update public.items set status = 'In progress', status_changed_at = now(), issues_total = 5, issues_closed = 2, delivery_progress_pct = 40 where id = $1", [id]);
    items.push(id);
  }
  return { project: p, key, items };
}
const release = (user: string, project: string, del = false, via = "UI") => db.asUser(user, async (q) => (await q("select public.jira_unlink_project_release($1, $2) as r", [project, del])).rows[0].r as Record<string, number>, { commit: true, via });
const row = async (id: string) => (await db.admin.query("select status, status_changed_at, issues_total, issues_closed, delivery_progress_pct, moscow, value_12m, deleted_at, home_project_id, initiative_name from public.items where id = $1", [id])).rows[0];

describe("jira_unlink_project_release: keep the initiatives", () => {
  it("removes the Jira links, trees and the project link; clears Build Status and its counts; keeps everything else; the project has no tracker again", async () => {
    const { project, items } = await linkedProject();
    await db.admin.query("insert into public.item_jira_tree (tenant_id, item_id, issue_key, level, title, issue_type, parent_key, status, status_category, position) values ($1, $2, 'T-1', 1, 'child', 'Task', 'X-1', 'To Do', 'new', 0)", [f.tenantA, items[0]]).catch(() => undefined);
    const r = await release(f.alice, project);
    expect(r).toMatchObject({ released: 2, cleared: 2, deleted: 0 });
    for (const id of items) {
      expect(await row(id)).toMatchObject({ status: null, status_changed_at: null, issues_total: null, issues_closed: null, delivery_progress_pct: null, moscow: "Must", value_12m: "555.00", deleted_at: null, home_project_id: project });
      expect((await db.admin.query("select count(*)::int n from public.item_jira_links where item_id = $1", [id])).rows[0].n).toBe(0);
      expect((await db.admin.query("select count(*)::int n from public.item_jira_tree where item_id = $1", [id])).rows[0].n).toBe(0);
    }
    expect((await db.admin.query("select count(*)::int n from public.jira_project_links where project_id = $1", [project])).rows[0].n).toBe(0);
    expect((await db.admin.query("select tracker from public.projects where id = $1", [project])).rows[0].tracker).toBeNull();
  });
  it("audits the clearing as the person with source UI", async () => {
    const { project, items } = await linkedProject();
    await release(f.alice, project);
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'status' order by id desc limit 1", [items[0]])).rows[0];
    expect(a).toMatchObject({ actor_id: f.alice, via: "UI" });
  });
  it("a project with no linked initiatives is released too (the same as the old unlink)", async () => {
    const { project, items } = await linkedProject();
    await db.admin.query("delete from public.item_jira_links where item_id = any ($1)", [items]);
    expect(await release(f.alice, project)).toMatchObject({ released: 0, deleted: 0 });
  });
});

describe("jira_unlink_project_release: delete the initiatives", () => {
  it("moves the live initiatives to the Trash (recoverable, not purged) and releases the project", async () => {
    const { project, items } = await linkedProject();
    const r = await release(f.alice, project, true);
    expect(r).toMatchObject({ released: 2, deleted: 2 });
    for (const id of items) expect((await row(id)).deleted_at).not.toBeNull();
    const trash = await db.asUser(f.alice, (q) => q("select id from public.trashed_items($1)", [f.tenantA]));
    for (const id of items) expect(trash.rows.map((x) => x.id)).toContain(id);
    expect((await db.admin.query("select tracker from public.projects where id = $1", [project])).rows[0].tracker).toBeNull();
  });
  it("an initiative that was already in the Trash stays there and is not counted as deleted now", async () => {
    const { project, items } = await linkedProject();
    await db.asUser(f.alice, (q) => q("select * from public.delete_items($1)", [[items[0]]]), { commit: true, via: "UI" });
    const r = await release(f.alice, project, true);
    expect(r).toMatchObject({ released: 2, deleted: 1 });
  });
});

describe("who may release a project", () => {
  it("refuses a creator, a service account, Claude (MCP) and another workspace's admin; nothing changes", async () => {
    const { project, items } = await linkedProject();
    expect(await errorCode(release(creator, project))).toBe(DENIED);
    expect(await errorCode(release(service, project))).toBe(DENIED);
    expect(await errorCode(release(f.alice, project, false, "MCP"))).toBe(DENIED);
    expect(await errorCode(release(bob, project))).toBe(DENIED);
    expect((await db.admin.query("select count(*)::int n from public.item_jira_links where item_id = any ($1)", [items])).rows[0].n).toBe(2);
    expect((await row(items[0]!)).status).toBe("In progress");
  });
  it("never reaches into another workspace", async () => {
    const other = await linkedProject(f.tenantB, connB);
    expect(await errorCode(release(f.alice, other.project))).toBe(DENIED);
  });
});

describe("pulling an issue in finds the initiative its marker names", () => {
  async function released() {
    const p = await linkedProject();
    await release(f.alice, p.project);
    // the project is linked again
    await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 'site-1', $4, $5, 'x', '1', 'Epic')", [f.tenantA, p.project, conn, String(3000 + n), p.key]);
    await db.admin.query("update public.projects set tracker = 'jira' where id = $1", [p.project]);
    return p;
  }
  const issue = async (project: string, key: string, num: number, labels: string[]) =>
    (await db.admin.query("insert into public.jira_issues (tenant_id, connection_id, project_id, site_id, jira_project_key, issue_key, issue_id, title, status, status_category, html_url, labels) values ($1, $2, $3, 'site-1', $4, $5, $6, 'T', 'In Progress', 'indeterminate', 'https://x.atlassian.net/browse/X', $7) returning id", [f.tenantA, conn, project, key, `${key}-${num}`, String(7000 + num), labels])).rows[0].id as string;
  const pull = (ids: string[], project: string, mode = "follow") => db.asUser(f.alice, async (q) => (await q("select * from public.jira_pull_in($1, $2, $3)", [ids, project, mode])).rows as { ok: boolean; reason: string | null; item_id: string | null }[], { commit: true, via: "UI" });

  it("links the issue to the unlinked initiative of the same project instead of creating a duplicate; owned by Product Velocity; Build Status from the issue", async () => {
    const { project, key, items } = await released();
    const a = await issue(project, key, 1, ["team", marker(items[0]!)]);
    const [r] = await pull([a], project);
    expect(r).toMatchObject({ ok: true, item_id: items[0] });
    expect(r!.reason).toMatch(/found by its marker/);
    expect((await db.admin.query("select mode, issue_key from public.item_jira_links where item_id = $1", [items[0]])).rows[0]).toMatchObject({ mode: "push", issue_key: `${key}-1` });
    expect((await row(items[0]!)).status).toBe("In progress");
    expect((await db.admin.query("select count(*)::int n from public.items where home_project_id = $1 and deleted_at is null", [project])).rows[0].n).toBe(2); // no duplicate
  });
  it("finds it under a stealth-mode prefix too, and does not touch an initiative of another project or one in the Trash", async () => {
    const { project, key, items } = await released();
    const a = await issue(project, key, 2, [marker(items[1]!, "x-m/")]);
    expect((await pull([a], project))[0]).toMatchObject({ ok: true, item_id: items[1] });
    const other = await released();
    const b = await issue(project, key, 3, [marker(other.items[0]!)]);
    const [rb] = await pull([b], project);
    expect(rb!.item_id).not.toBe(other.items[0]); // a marker of another project's initiative creates a new one here
    const c = await released();
    await db.asUser(f.alice, (q) => q("select * from public.delete_items($1)", [[c.items[0]]]), { commit: true, via: "UI" });
    const d = await issue(c.project, c.key, 4, [marker(c.items[0]!)]);
    expect((await pull([d], c.project))[0]!.item_id).not.toBe(c.items[0]);
  });
  it("an issue with no matching marker still creates a new initiative", async () => {
    const { project, key } = await released();
    const a = await issue(project, key, 5, ["pm:item/0000000000000000", "plain"]);
    const [r] = await pull([a], project);
    expect(r).toMatchObject({ ok: true, reason: null });
    expect((await db.admin.query("select source from public.items where id = $1", [r!.item_id])).rows[0].source).toBe(`Jira issue ${key}-5`);
  });
});
