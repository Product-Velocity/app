import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, errorCode, type TestDb } from "./helpers";

// Ready for build at Gate B (issue #358): github_record_ready / jira_record_ready only REMEMBER that the tracker status was handled once; the tracker calls are
// made by the app after the person confirmed. Same boundaries as the removed-initiative twins: creator or admin who is a person, never Claude (MCP), never a
// followed link, only a Ready for build initiative, handled once.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string, outsider: string;
let ghConn: string, jiraConn: string, proj: string;
let n = 0;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-rg@example.test");
  viewer = await createUser(db, "viewer-rg@example.test");
  service = await createUser(db, "service-rg@example.test");
  outsider = await createUser(db, "outsider-rg@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  await addMember(db, f.bob, f.tenantB, outsider, "admin");
  proj = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'Ready project') returning id", [f.tenantA])).rows[0].id as string;
  ghConn = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
  jiraConn = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

type Provider = "github" | "jira";
async function setup(p: Provider, o: { mode?: "push" | "follow"; ready?: boolean; phase?: string; trashed?: boolean } = {}) {
  const num = 900 + ++n;
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, value_12m, decision, status, initiative_status, initiative_phase) values ($1, $2, 'Go build', 555, 'Go', 'Not started', 'Active', $3) returning id", [f.tenantA, proj, o.phase ?? "Build"])).rows[0].id as string;
  if (o.ready !== false) await db.admin.query("update public.items set ready_for_build_at = now() where id = $1", [item]);
  if (p === "github") await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'acme/road', $4, $5, $6, 'synced', $7)", [f.tenantA, item, ghConn, num, num * 10, `https://github.com/acme/road/issues/${num}`, o.mode ?? "push"]);
  else await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, $5)", [f.tenantA, item, jiraConn, `RG-${num}`, o.mode ?? "push"]);
  if (o.trashed) await db.admin.query("update public.items set deleted_at = now() where id = $1", [item]);
  return item;
}
const call = (sql: string, params: unknown[], via = "UI") => db.asService((q) => q(sql, params), { commit: true, via });
const table = (p: Provider) => (p === "github" ? "item_github_links" : "item_jira_links");
const link = async (p: Provider, id: string) => (await db.admin.query(`select * from public.${table(p)} where item_id = $1`, [id])).rows[0];
const record = (p: Provider, who: string, id: string, result = "set", status: string | null = "Ready", via = "UI") => call(`select public.${p}_record_ready($1, $2, $3, $4)`, [who, id, result, status], via);

describe.each(["github", "jira"] as Provider[])("%s_record_ready", (p) => {
  it("columns exist and handled/result go together", async () => {
    const item = await setup(p);
    await expect(db.admin.query(`select ready_handled_at, ready_result, ready_status from public.${table(p)} limit 1`)).resolves.toBeDefined();
    expect(await errorCode(db.admin.query(`update public.${table(p)} set ready_handled_at = now() where item_id = $1`, [item]))).not.toBeNull();
  });
  it("records once, audited as the person (source UI); nothing of the initiative changes", async () => {
    const item = await setup(p);
    await record(p, creator, item);
    expect(await link(p, item)).toMatchObject({ ready_result: "set", ready_status: "Ready" });
    const first = (await link(p, item)).ready_handled_at;
    await record(p, creator, item, "already_ahead", "Done"); // a second call changes nothing
    expect(await link(p, item)).toMatchObject({ ready_result: "set", ready_status: "Ready" });
    expect((await link(p, item)).ready_handled_at).toEqual(first);
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = $1 and entity_id = $2 and field = 'ready_result' order by id desc limit 1", [table(p), (await link(p, item)).id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
    const i = (await db.admin.query("select status, initiative_status, initiative_phase, value_12m, decision from public.items where id = $1", [item])).rows[0];
    expect(i).toMatchObject({ status: "Not started", initiative_status: "Active", initiative_phase: "Build", value_12m: "555.00", decision: "Go" });
  });
  it("refuses a viewer, a service account, Claude (MCP) and another workspace's admin", async () => {
    const item = await setup(p);
    for (const who of [viewer, service, outsider]) expect(await errorCode(record(p, who, item))).toBe(DENIED);
    expect(await errorCode(record(p, creator, item, "set", "Ready", "MCP"))).toBe(DENIED);
    expect((await link(p, item)).ready_handled_at).toBeNull();
  });
  it("refuses a followed link", async () => {
    const item = await setup(p, { mode: "follow" });
    expect(await errorCode(record(p, creator, item))).toBe(DENIED);
  });
  it("refuses an initiative that is not Ready for build (Hold or Stop at Gate B leave ready_for_build_at empty), not in Build, or in the Trash", async () => {
    for (const o of [{ ready: false }, { phase: "Define" }, { trashed: true }]) {
      const item = await setup(p, o);
      expect(await errorCode(record(p, creator, item))).toBe("22023");
    }
  });
  it("accepts only set or already_ahead", async () => {
    const item = await setup(p);
    expect(await errorCode(record(p, creator, item, "closed"))).toBe("22023");
  });
});
