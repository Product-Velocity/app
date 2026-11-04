import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Jira: label and close the issue of a removed initiative (decision 2026-11-03-jira-close-removed). jira_record_removed only REMEMBERS that it
// was handled; the Jira calls are made by the app (tested against a fake Jira). Two tenants: another workspace's person can do nothing.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string;
let connA: string;
let n = 0;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-cr@example.test");
  viewer = await createUser(db, "viewer-cr@example.test");
  service = await createUser(db, "service-cr@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

/** A project linked to Jira project key CR<n>, and an initiative in it linked to CR<n>-1 in the given mode, optionally already in the Trash. */
async function setup(o: { mode?: "push" | "follow"; trashed?: boolean } = {}) {
  const key = `CR${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, $2, 'jira') returning id", [f.tenantA, `Jira ${key}`])).rows[0].id as string;
  await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 'site-1', $4, $5, 'Plat', '10000', 'Epic')", [f.tenantA, p, connA, String(2000 + n), key]);
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, value_12m, decision, status, initiative_status) values ($1, $2, 'Gone', 777, 'Go', 'Not started', 'On hold') returning id", [f.tenantA, p])).rows[0].id as string;
  await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, $5)", [f.tenantA, item, connA, `${key}-1`, o.mode ?? "push"]);
  if (o.trashed !== false) await db.admin.query("update public.items set deleted_at = now() where id = $1", [item]);
  return { item, key, project: p };
}
const call = (sql: string, params: unknown[], via = "UI") => db.asService((q) => q(sql, params), { commit: true, via });
const link = async (id: string) => (await db.admin.query("select * from public.item_jira_links where item_id = $1", [id])).rows[0];
const record = (who: string, id: string, result = "closed", name: string | null = "Done", sid: string | null = "10001") => call("select public.jira_record_removed($1, $2, $3, $4, $5)", [who, id, result, name, sid]);

describe("the columns exist and the app reads them", () => {
  it("removed_handled_at, removed_result, removed_status and the project's remembered status", async () => {
    await expect(db.admin.query("select removed_handled_at, removed_result, removed_status from public.item_jira_links limit 1")).resolves.toBeDefined();
    await expect(db.admin.query("select removed_close_status_id from public.jira_project_links limit 1")).resolves.toBeDefined();
  });
  it("handled and result go together", async () => {
    const { item } = await setup();
    expect(await errorCode(db.admin.query("update public.item_jira_links set removed_handled_at = now() where item_id = $1", [item]))).not.toBeNull();
  });
});

describe("jira_record_removed", () => {
  it("records a close for a removed, owned initiative: result, status, the project's remembered choice; audited as the person, source UI; nothing else changes", async () => {
    const { item, key } = await setup();
    await record(creator, item);
    expect(await link(item)).toMatchObject({ removed_result: "closed", removed_status: "Done", mode: "push" });
    expect((await link(item)).removed_handled_at).not.toBeNull();
    expect((await db.admin.query("select removed_close_status_id from public.jira_project_links where jira_project_key = $1", [key])).rows[0].removed_close_status_id).toBe("10001");
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_jira_links' and entity_id = $1 and field = 'removed_result' order by id desc limit 1", [(await link(item)).id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
    // the initiative itself is untouched: no status, no commercial field, still in the Trash
    const i = (await db.admin.query("select status, initiative_status, value_12m, decision, deleted_at from public.items where id = $1", [item])).rows[0];
    expect(i).toMatchObject({ status: "Not started", initiative_status: "On hold", value_12m: "777.00", decision: "Go" });
    expect(i.deleted_at).not.toBeNull();
  });
  it("labeled and already_done and not_found are recorded without a status and without changing the project's remembered one", async () => {
    for (const r of ["labeled", "already_done", "not_found"]) {
      const { item, key } = await setup();
      await record(creator, item, r, "Done", "10001");
      expect(await link(item)).toMatchObject({ removed_result: r, removed_status: null });
      expect((await db.admin.query("select removed_close_status_id from public.jira_project_links where jira_project_key = $1", [key])).rows[0].removed_close_status_id).toBeNull();
    }
  });
  it("is handled once: a second call changes nothing", async () => {
    const { item } = await setup();
    await record(creator, item, "labeled", null, null);
    const first = await link(item);
    await record(creator, item, "closed", "Done", "10001");
    expect(await link(item)).toMatchObject({ removed_result: "labeled", removed_handled_at: first.removed_handled_at });
  });
  it("NEVER for an issue that came from Jira (mode follow)", async () => {
    const { item } = await setup({ mode: "follow" });
    expect(await errorCode(record(creator, item))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("NEVER for an initiative that is not in the Trash (and so not after a restore either)", async () => {
    const { item } = await setup({ trashed: false });
    expect(await errorCode(record(creator, item))).toBe("22023");
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is refused for a viewer, a service account (Claude's kind) and a person of another workspace; nothing is recorded", async () => {
    const { item } = await setup();
    for (const who of [viewer, service, f.bob]) expect(await errorCode(record(who, item)), who).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is refused when the write comes from Claude (MCP), even for a creator", async () => {
    const { item } = await setup();
    expect(await errorCode(call("select public.jira_record_removed($1, $2, 'closed', 'Done', '10001')", [creator, item], "MCP"))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is not callable by a signed-in person or the public: service role only", async () => {
    const { item } = await setup();
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_record_removed($1, $2, 'closed', 'Done', '10001')", [f.alice, item])))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  }, 20000);
  it("rejects an unknown result, an unknown item and a status id that is not a number", async () => {
    const { item, key } = await setup();
    expect(await errorCode(record(creator, item, "reopened"))).toBe("22023");
    expect(await errorCode(record(creator, "99999999-9999-4999-8999-999999999999"))).toBe("P0002");
    await record(creator, item, "closed", "Done", "not-a-number");
    expect((await db.admin.query("select removed_close_status_id from public.jira_project_links where jira_project_key = $1", [key])).rows[0].removed_close_status_id).toBeNull();
  });
});
