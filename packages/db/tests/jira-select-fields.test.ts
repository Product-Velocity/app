import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #512: jira_select_map / jira_set_select_map (Health, Initiative Status and Initiative Phase on Jira custom select fields) and jira_apply_select_pull.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string, bob: string;
let projectA: string, projectB: string, githubProject: string, connA: string;
const DENIED = "42501";
const BAD = "22023";
const health = { slot: "jira.select.health", field: "customfield_10100", direction: "two_way", options: { "On Track": "201", "At Risk": "202" } };
const status = { slot: "jira.select.initiative_status", field: "customfield_10101", direction: "to_jira", options: { Active: "211" } };
const phase = { slot: "jira.select.initiative_phase", field: "customfield_10102", direction: "to_jira", options: { Build: "221" } };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-jsf@example.test");
  service = await createUser(db, "service-jsf@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  bob = f.bob;
  projectA = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Jira A', 'jira') returning id", [f.tenantA])).rows[0].id as string;
  projectB = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Jira B', 'jira') returning id", [f.tenantB])).rows[0].id as string;
  githubProject = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'GH', 'github') returning id", [f.tenantA])).rows[0].id as string;
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

const set = (user: string, project: string, rows: unknown, via = "UI") => db.asUser(user, (q) => q("select public.jira_set_select_map($1, $2::jsonb)", [project, JSON.stringify(rows)]), { commit: true, via });
const stored = async (project: string) => (await db.admin.query("select slot, field_id, direction, options from public.jira_select_map where project_id = $1 order by slot", [project])).rows;

describe("jira_set_select_map", () => {
  it("a human admin saves the mapping; every change is audited as the person with source UI", async () => {
    await set(f.alice, projectA, [health, status, phase]);
    expect((await stored(projectA)).map((r) => r.slot)).toEqual(["jira.select.health", "jira.select.initiative_phase", "jira.select.initiative_status"]);
    const a = await db.admin.query("select via, actor_id from public.audit_log where entity = 'jira_select_map' and entity_id in (select id from public.jira_select_map where project_id = $1)", [projectA]);
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.rows.every((r) => r.via === "UI" && r.actor_id === f.alice)).toBe(true);
  });
  it("saving the same mapping again adds no audit entry, and an empty list removes it", async () => {
    const n = async () => (await db.admin.query("select count(*)::int n from public.audit_log where entity = 'jira_select_map' and actor_id is not null")).rows[0].n as number;
    const before = await n();
    await set(f.alice, projectA, [health, status, phase]);
    expect(await n()).toBe(before);
    await set(f.alice, projectA, []);
    expect(await stored(projectA)).toEqual([]);
  });
  it("refuses a creator, a service account, Claude (MCP), another workspace's admin and a non-member", async () => {
    for (const who of [creator, service]) expect(await errorCode(set(who, projectA, [health])), who).toBe(DENIED);
    expect(await errorCode(set(f.alice, projectA, [health], "MCP")), "claude").toBe(DENIED);
    expect(await errorCode(set(f.alice, projectB, [health])), "other workspace").toBe(DENIED);
    expect(await errorCode(set(bob, projectA, [health])), "bob").toBe(DENIED);
    expect(await stored(projectA)).toEqual([]);
  });
  it("Initiative Phase can only go to Jira: two_way is refused here and by the table", async () => {
    expect(await errorCode(set(f.alice, projectA, [{ ...phase, direction: "two_way" }]))).toBe(BAD);
    await expect(db.admin.query("insert into public.jira_select_map (tenant_id, project_id, slot, field_id, direction, options) values ($1, $2, 'jira.select.initiative_phase', 'customfield_1', 'two_way', '{}')", [f.tenantA, projectA])).rejects.toBeDefined();
  });
  it("refuses a slot that is not on the closed list, a field that is not custom, a field used twice, and bad options", async () => {
    const bad: unknown[] = [
      [{ ...health, slot: "jira.select.value_12m" }], [{ ...health, slot: "jira.select.moscow" }], [{ ...health, field: "summary" }], [{ ...health, field: "status" }],
      [health, { ...status, field: health.field }], [health, health], [{ ...health, options: { "On Track": "abc" } }], [{ ...health, options: { "On Track": 201 } }],
      [{ ...health, options: { "On Track": "201", "At Risk": "201" } }], [{ ...health, direction: "sideways" }], "x", [{ slot: "jira.select.health" }],
    ];
    for (const rows of bad) expect(await errorCode(set(f.alice, projectA, rows)), JSON.stringify(rows)).toBe(BAD);
    expect(await stored(projectA)).toEqual([]);
  });
  it("refuses a project without a Jira tracker", async () => {
    expect(await errorCode(set(f.alice, githubProject, [health]))).toBe("P0002");
  });
  it("members read their own workspace's mapping and never another's (RLS)", async () => {
    await set(f.alice, projectA, [health]);
    const mine = await db.asUser(creator, (q) => q("select slot from public.jira_select_map where project_id = $1", [projectA]));
    expect(mine.rows.map((r) => r.slot)).toEqual(["jira.select.health"]);
    const theirs = await db.asUser(bob, (q) => q("select slot from public.jira_select_map where project_id = $1", [projectA]));
    expect(theirs.rows).toEqual([]);
    await set(f.alice, projectA, []);
  });
});

describe("jira_apply_select_pull", () => {
  async function linked(mode: "push" | "follow" = "push") {
    const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, health, initiative_status, initiative_phase, value_12m) values ($1, $2, 'X', 'On Track', 'Active', 'Build', 777) returning id", [f.tenantA, projectA])).rows[0].id as string;
    await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, $5)", [f.tenantA, item, connA, `SEL-${Math.floor(Math.random() * 1e6)}`, mode]);
    return item;
  }
  const call = (item: string, actor: string, fields: unknown, base: unknown = { health: "At Risk" }) => db.asService((q) => q("select public.jira_apply_select_pull($1, $2, $3::jsonb, $4::jsonb) as r", [actor, item, JSON.stringify(fields), JSON.stringify(base)]), { commit: true, via: "UI" });
  const row = async (id: string) => (await db.admin.query("select health, initiative_status, initiative_phase, value_12m from public.items where id = $1", [id])).rows[0];

  it("takes over Health, returns the old value, records the base and audits the person", async () => {
    const id = await linked();
    const r = await call(id, creator, { health: "At Risk" });
    expect(r.rows[0].r).toEqual({ health: "On Track" });
    expect(await row(id)).toMatchObject({ health: "At Risk", initiative_status: "Active", initiative_phase: "Build", value_12m: "777.00" });
    expect((await db.admin.query("select sync_base from public.item_jira_links where item_id = $1", [id])).rows[0].sync_base).toEqual({ health: "At Risk" });
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'health' order by id desc limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
  });
  it("takes over Initiative Status", async () => {
    const id = await linked();
    await call(id, creator, { initiative_status: "On hold" }, { initiative_status: "On hold" });
    expect((await row(id)).initiative_status).toBe("On hold");
  });
  it("NEVER takes over Initiative Phase, Build Status or a commercial field: the phase is the gates' to move", async () => {
    const id = await linked();
    for (const fields of [{ initiative_phase: "Test" }, { status: "Done" }, { value_12m: "1" }, { decision: "Go" }, { health: "At Risk", initiative_phase: "Test" }]) {
      expect(await errorCode(call(id, creator, fields)), JSON.stringify(fields)).toBe(BAD);
    }
    expect(await row(id)).toMatchObject({ initiative_phase: "Build", health: "On Track" });
  });
  it("refuses a value the item does not allow, a service account, a follow link, and another workspace's item", async () => {
    const id = await linked();
    await expect(call(id, creator, { health: "Great" })).rejects.toBeDefined();
    expect(await errorCode(call(id, service, { health: "At Risk" }))).toBe(DENIED);
    expect(await errorCode(call(id, bob, { health: "At Risk" }))).toBe(DENIED);
    const follow = await linked("follow");
    expect(await errorCode(call(follow, creator, { health: "At Risk" }))).toBe("P0002");
    expect((await row(id)).health).toBe("On Track");
  });
});
