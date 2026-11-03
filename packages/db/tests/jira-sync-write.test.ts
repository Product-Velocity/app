import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Jira, the write side of Sync (issue #67, #71): jira_record_sync, jira_create_link and jira_apply_pull.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string;
let connA: string, connB: string;
let n = 0;
const DENIED = "42501";
const H = (c: string) => c.repeat(64);
const S = (c: string) => c.repeat(64);

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-jw@example.test");
  viewer = await createUser(db, "viewer-jw@example.test");
  service = await createUser(db, "service-jw@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

/** A project linked to a Jira project with key JW<n>, and an initiative in it (optionally linked to JW<n>-1 in the given mode). */
async function setup(tenant = f.tenantA, conn = connA, mode: "push" | "follow" | null = "push") {
  const key = `JW${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, $2, 'jira') returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 'site-1', $4, $5, 'Plat', '10000', 'Epic')", [tenant, p, conn, String(1000 + n), key]);
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, description, value_12m, confidence, decision) values ($1, $2, 'Old name', 'Old text', 777, 'High', 'Go') returning id", [tenant, p])).rows[0].id as string;
  if (mode) await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, $5)", [tenant, item, conn, `${key}-1`, mode]);
  return { item, key, project: p };
}
const call = (sql: string, params: unknown[]) => db.asService((q) => q(sql, params), { commit: true, via: "UI" });
const item = async (id: string) => (await db.admin.query("select initiative_name, description, value_12m, confidence, decision, status, initiative_status from public.items where id = $1", [id])).rows[0];
const link = async (id: string) => (await db.admin.query("select * from public.item_jira_links where item_id = $1", [id])).rows[0];

describe("the items columns the Jira engine reads", () => {
  it("all exist (the web test pins the same list): G2M Date (est) is stored in end_date", async () => {
    const cols = ["id", "item_code", "initiative_name", "description", "moscow", "end_date", "planned_start", "home_project_id"];
    await expect(db.admin.query(`select ${cols.join(", ")} from public.items limit 1`)).resolves.toBeDefined();
    const missing = await db.admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'g2m_date_est'");
    expect(missing.rows).toEqual([]);
  });
});

describe("jira_apply_pull (Keep Jira)", () => {
  it("replaces only the chosen texts, returns the old values, records the base and audits the person", async () => {
    const { item: id } = await setup();
    const r = await call("select public.jira_apply_pull($1, $2, $3::jsonb, $4::jsonb) as r", [creator, id, JSON.stringify({ initiative_name: "New name", description: "New text" }), JSON.stringify({ title: H("a"), description: H("b") })]);
    expect(r.rows[0].r).toEqual({ initiative_name: "Old name", description: "Old text" });
    expect(await item(id)).toMatchObject({ initiative_name: "New name", description: "New text", confidence: "High", decision: "Go" });
    expect((await link(id)).sync_base).toEqual({ title: H("a"), description: H("b") });
    const a = (await db.admin.query("select actor_id, via, new #>> '{}' as v from public.audit_log where entity = 'items' and entity_id = $1 and field = 'initiative_name' order by id desc limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI", v: "New name" });
  });
  it("refuses any field outside the allowlist, commercial ones and status included, and changes nothing", async () => {
    const { item: id } = await setup();
    for (const bad of ["value_12m", "confidence", "decision", "stack_rank", "status", "initiative_status", "summary"]) {
      expect(await errorCode(call("select public.jira_apply_pull($1, $2, $3::jsonb, null)", [creator, id, JSON.stringify({ [bad]: "x" })])), bad).toBe("22023");
    }
    expect(await item(id)).toMatchObject({ initiative_name: "Old name", value_12m: "777.00" });
  });
  it("is refused for a viewer, a service account, another workspace's person and a read-only link", async () => {
    const { item: id } = await setup();
    const { item: ro } = await setup(f.tenantA, connA, "follow");
    const body = JSON.stringify({ initiative_name: "Hacked" });
    for (const who of [viewer, service, f.bob]) expect(await errorCode(call("select public.jira_apply_pull($1, $2, $3::jsonb, null)", [who, id, body]))).toBe(DENIED);
    expect(await errorCode(call("select public.jira_apply_pull($1, $2, $3::jsonb, null)", [creator, ro, body]))).toBe("P0002");
    expect((await item(id)).initiative_name).toBe("Old name");
  });
  it("needs a name", async () => {
    const { item: id } = await setup();
    expect(await errorCode(call("select public.jira_apply_pull($1, $2, $3::jsonb, null)", [creator, id, JSON.stringify({ initiative_name: "  " })]))).toBe("22023");
  });
});

describe("jira_record_sync", () => {
  it("stores the base and the sent hash and merges later bases", async () => {
    const { item: id } = await setup();
    await call("select public.jira_record_sync($1, $2, $3::jsonb, $4)", [creator, id, JSON.stringify({ title: H("1"), description: H("2") }), S("9")]);
    await call("select public.jira_record_sync($1, $2, $3::jsonb, null)", [creator, id, JSON.stringify({ description: H("3") })]);
    const l = await link(id);
    expect(l.sync_base).toEqual({ title: H("1"), description: H("3") });
    expect(l.sent_hash).toBe(S("9"));
    expect(l.sync_checked_at).not.toBeNull();
  });
  it("refuses a viewer, a service account, another workspace and a read-only link; stores no text", async () => {
    const { item: id } = await setup();
    const { item: ro } = await setup(f.tenantA, connA, "follow");
    for (const who of [viewer, service, f.bob]) expect(await errorCode(call("select public.jira_record_sync($1, $2, '{}'::jsonb, null)", [who, id]))).toBe(DENIED);
    expect(await errorCode(call("select public.jira_record_sync($1, $2, '{}'::jsonb, null)", [creator, ro]))).toBe("P0002");
    expect(await errorCode(call("select public.jira_record_sync($1, $2, '{}'::jsonb, $3)", [creator, id, "not-a-hash"]))).not.toBeNull();
  });
});

describe("jira_create_link", () => {
  it("links a new issue as owned by Product Velocity, with the base, for an initiative in the linked project", async () => {
    const { item: id, key } = await setup(f.tenantA, connA, null);
    await call("select public.jira_create_link($1, $2, $3, 'site-1', $4, '10042', 'https://x.atlassian.net/browse/' || $4, $5::jsonb, $6)", [creator, id, connA, `${key}-7`, JSON.stringify({ title: H("1") }), S("4")]);
    expect(await link(id)).toMatchObject({ issue_key: `${key}-7`, mode: "push", created_by: creator, created_via: "UI", issue_id: "10042" });
  });
  it("refuses a key of another Jira project, another workspace's connection, a viewer and a service account", async () => {
    const { item: id, key } = await setup(f.tenantA, connA, null);
    const args = (who: string, k: string, conn = connA) => [who, id, conn, k];
    const sql = "select public.jira_create_link($1, $2, $3, 'site-1', $4, null, null, '{}'::jsonb, null)";
    expect(await errorCode(call(sql, args(creator, "OTHER-1")))).toBe("PV008");
    expect(await errorCode(call(sql, args(creator, `${key}-1`, connB)))).toBe("PV008");
    for (const who of [viewer, service]) expect(await errorCode(call(sql, args(who, `${key}-1`)))).toBe(DENIED);
    expect(await link(id)).toBeUndefined();
  });
  it("an initiative has one tracker: a second link is refused", async () => {
    const { item: id, key } = await setup();
    expect(await errorCode(call("select public.jira_create_link($1, $2, $3, 'site-1', $4, null, null, '{}'::jsonb, null)", [creator, id, connA, `${key}-9`]))).not.toBeNull();
  });
});
