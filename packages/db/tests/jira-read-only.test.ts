import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Jira read-only mode per project (issue #656): the flag, who may change it, the guards that keep writes out, and the tree of epics listed on an
// initiative that has no Jira issue.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let connA: string;
let connB: string;
let n = 0;
let seq = 5000;
const DENIED = "42501";
const BLOCKED = "PV013";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-ro@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

/** An initiative of a project linked to its own Jira project; `readOnly` sets the mode of the link. */
async function setup(opts: { readOnly?: boolean; tenant?: string; conn?: string } = {}) {
  const tenant = opts.tenant ?? f.tenantA;
  const conn = opts.conn ?? connA;
  const i = ++n;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, $2, 'jira') returning id", [tenant, `ReadOnly ${i}`])).rows[0].id as string;
  await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name, read_only) values ($1, $2, $3, 'site-1', $4, $5, 'Roadmap', '10010', 'Initiative', $6)", [tenant, p, conn, `3000${i}`, `RO${i}`, opts.readOnly ?? false]);
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source, status) values ($1, $2, 'Listens', 'test', 'Not started') returning id", [tenant, p])).rows[0].id as string;
  return { item, project: p };
}
const key = () => `R8P-${++seq}`;
const setMode = (who: string, project: string, ro: boolean) => db.asUser(who, async (q) => (await q("select public.jira_set_project_read_only($1, $2) as r", [project, ro])).rows[0].r as boolean, { commit: true });
const request = (who: string, item: string, keys: string[]) => db.asUser(who, async (q) => (await q("select public.item_request_jira_epics($1, $2::text[]) as r", [item, keys])).rows[0].r as string[], { commit: true });
const node = (k: string, level: 1 | 2, parent: string, category: string | null, pos = 0) => ({ key: k, id: String(10000 + pos), parent, level, position: pos, title: `Title ${k}`, type: level === 1 ? "Epic" : "Story", status: category === "done" ? "Done" : "In Progress", category, assignee: null, url: `https://x.atlassian.net/browse/${k}`, updated: "2026-11-20T10:00:00Z" });
const apply = (conn: string, item: string, nodes: unknown[], total: number, closed: number, pct: number | null, category: string | null, site = "site-1") =>
  db.asService(async (q) => (await q("select public.jira_apply_epic_tree($1, $2, $3, $4::jsonb, $5, $6, $7, $8) as r", [conn, site, item, JSON.stringify(nodes), total, closed, pct, category])).rows[0].r as Record<string, unknown>, { commit: true });

describe("jira_set_project_read_only", () => {
  it("a workspace admin switches the mode both ways, and the old value comes back; the change is audited", async () => {
    const { project } = await setup();
    expect(await setMode(f.alice, project, true)).toBe(false);
    expect((await db.admin.query("select read_only from public.jira_project_links where project_id = $1", [project])).rows[0].read_only).toBe(true);
    expect(await setMode(f.alice, project, false)).toBe(true);
    const audit = (await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'jira_project_links' and field = 'read_only' and tenant_id = $1", [f.tenantA])).rows[0].n as number;
    expect(audit).toBeGreaterThanOrEqual(2);
  });
  it("a creator cannot change it", async () => {
    const { project } = await setup();
    expect(await errorCode(setMode(creator, project, true))).toBe(DENIED);
  });
  it("another workspace's admin cannot change it, and an unlinked project cannot be set", async () => {
    const { project } = await setup();
    expect(await errorCode(setMode(f.bob, project, true))).toBe(DENIED);
    const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'No link') returning id", [f.tenantA])).rows[0].id as string;
    expect(await errorCode(setMode(f.alice, p, true))).toBe("22023");
  });
  it("Claude (source MCP) cannot change it", async () => {
    const { project } = await setup();
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_set_project_read_only($1, true)", [project]), { via: "MCP", commit: true }))).toBe(DENIED);
  });
  it("members of another workspace cannot read the flag (row-level security)", async () => {
    const { project } = await setup();
    const seen = await db.asUser(f.bob, async (q) => (await q("select read_only from public.jira_project_links where project_id = $1", [project])).rows.length);
    expect(seen).toBe(0);
  });
});

describe("guards on a read-only project", () => {
  it("an initiative cannot be given a Jira link in mode push, but can be followed", async () => {
    const { item } = await setup({ readOnly: true });
    expect(await errorCode(db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', 'RO1-1', 'push')", [f.tenantA, item, connA]))).toBe(BLOCKED);
    await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', 'RO1-2', 'follow')", [f.tenantA, item, connA]);
    expect(await errorCode(db.admin.query("update public.item_jira_links set mode = 'push' where item_id = $1", [item]))).toBe(BLOCKED);
  });
  it("the same project can own an issue again once it is switched to can-write", async () => {
    const { item, project } = await setup({ readOnly: true });
    await setMode(f.alice, project, false);
    await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', 'RO2-1', 'push')", [f.tenantA, item, connA]);
  });
  it("an epic request can be recorded (it only lists the key) but never marked linked", async () => {
    const { item } = await setup({ readOnly: true });
    const k = key();
    expect(await request(f.alice, item, [k])).toEqual([k]);
    expect(await errorCode(db.asService((q) => q("select public.jira_record_epic_link($1, $2, $3, true, null, null)", [f.alice, item, k]), { commit: true }))).toBe(BLOCKED);
    expect((await db.admin.query("select state from public.item_jira_epic_requests where item_id = $1", [item])).rows[0].state).toBe("pending");
  });
  it("on a can-write project nothing changes: a request is marked linked as before", async () => {
    const { item } = await setup();
    await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', 'RO3-1', 'push')", [f.tenantA, item, connA]);
    const k = key();
    await request(f.alice, item, [k]);
    await db.asService((q) => q("select public.jira_record_epic_link($1, $2, $3, true, null, null)", [f.alice, item, k]), { commit: true });
    expect((await db.admin.query("select state from public.item_jira_epic_requests where item_id = $1", [item])).rows[0].state).toBe("linked");
  });
});

describe("jira_apply_epic_tree", () => {
  it("stores the listed epics and their children, rolls up the counts and derives Build Status from the epics", async () => {
    const { item } = await setup({ readOnly: true });
    const [e1, e2, s1, s2, s3] = [key(), key(), key(), key(), key()];
    await request(f.alice, item, [e1, e2]);
    const nodes = [node(e1, 1, e1, "indeterminate", 0), node(s1, 2, e1, "done", 1), node(s2, 2, e1, "new", 2), node(e2, 1, e2, "new", 3), node(s3, 2, e2, "new", 4)];
    const r = await apply(connA, item, nodes, 3, 1, 33, "indeterminate");
    expect(r).toMatchObject({ nodes: 5, written: 5, rolled_up: true, changes: { status: ["Not started", "In progress"] } });
    const it = (await db.admin.query("select status, initiative_status, issues_total, issues_closed, delivery_progress_pct from public.items where id = $1", [item])).rows[0];
    expect(it).toMatchObject({ status: "In progress", issues_total: 3, issues_closed: 1 });
    expect(Number(it.delivery_progress_pct)).toBe(33);
    expect((await db.admin.query("select count(*)::int as n from public.item_jira_tree where item_id = $1", [item])).rows[0].n).toBe(5);
  });
  it("never touches Initiative Status (a done epic does not complete the initiative)", async () => {
    const { item } = await setup({ readOnly: true });
    const e = key();
    await request(f.alice, item, [e]);
    await db.admin.query("update public.items set initiative_status = 'On hold' where id = $1", [item]);
    await apply(connA, item, [node(e, 1, e, "done", 0)], 1, 1, 100, "done");
    expect((await db.admin.query("select status, initiative_status from public.items where id = $1", [item])).rows[0]).toEqual({ status: "Done", initiative_status: "On hold" });
  });
  it("compares before writing: the same read again changes nothing and adds no audit rows", async () => {
    const { item } = await setup({ readOnly: true });
    const e = key();
    await request(f.alice, item, [e]);
    const nodes = [node(e, 1, e, "new", 0)];
    await apply(connA, item, nodes, 1, 0, 0, "new");
    const count = async () => (await db.admin.query("select count(*)::int as n from public.audit_log where entity_id = $1", [item])).rows[0].n as number;
    const before = await count();
    expect(await apply(connA, item, nodes, 1, 0, 0, "new")).toMatchObject({ written: 0, rolled_up: false, changes: {} });
    expect(await count()).toBe(before);
  });
  it("an epic that left the list is removed from the tree", async () => {
    const { item } = await setup({ readOnly: true });
    const [a, b] = [key(), key()];
    await request(f.alice, item, [a, b]);
    await apply(connA, item, [node(a, 1, a, "new", 0), node(b, 1, b, "new", 1)], 2, 0, 0, "new");
    expect(await apply(connA, item, [node(a, 1, a, "new", 0)], 1, 0, 0, "new")).toMatchObject({ removed: 1 });
  });
  it("refuses an initiative of a can-write project, one with no epics listed, and the wrong connection", async () => {
    const w = await setup();
    const e = key();
    await request(f.alice, w.item, [e]);
    expect(await errorCode(apply(connA, w.item, [node(e, 1, e, "new")], 1, 0, 0, "new"))).toBe("22023");
    const r = await setup({ readOnly: true });
    expect(await errorCode(apply(connA, r.item, [], 0, 0, null, null))).toBe("22023");
    const x = key();
    await request(f.alice, r.item, [x]);
    expect(await errorCode(apply(connB, r.item, [node(x, 1, x, "new")], 1, 0, 0, "new"))).toBe("22023");
  });
  it("is for the service role only", async () => {
    const { item } = await setup({ readOnly: true });
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_apply_epic_tree($1, 'site-1', $2, '[]'::jsonb, 0, 0, null, null)", [connA, item])))).toBe(DENIED);
  });
  it("rejects malformed counts and categories", async () => {
    const { item } = await setup({ readOnly: true });
    const e = key();
    await request(f.alice, item, [e]);
    expect(await errorCode(apply(connA, item, [], 1, 2, 100, null))).toBe("22023");
    expect(await errorCode(apply(connA, item, [], 0, 0, null, "bogus"))).toBe("22023");
  });
});
