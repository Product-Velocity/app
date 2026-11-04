import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Tracker field configuration (decision 2026-11-03-tracker-field-config): tracker_set_field_config and the tracker_field_config table.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string, bob: string;
let projectA: string, projectB: string, noTracker: string, githubProject: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-tfc@example.test");
  service = await createUser(db, "service-tfc@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  bob = f.bob;
  projectA = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Jira A', 'jira') returning id", [f.tenantA])).rows[0].id as string;
  projectB = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Jira B', 'jira') returning id", [f.tenantB])).rows[0].id as string;
  noTracker = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'No tracker') returning id", [f.tenantA])).rows[0].id as string;
  githubProject = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'On GitHub', 'github') returning id", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

const set = (user: string, project: string, rows: unknown, via = "UI") => db.asUser(user, (q) => q("select public.tracker_set_field_config($1, $2::jsonb)", [project, JSON.stringify(rows)]), { commit: true, via });
const stored = async (project: string) => (await db.admin.query("select slot, enabled, field_id from public.tracker_field_config where project_id = $1 order by slot", [project])).rows;

describe("tracker_set_field_config", () => {
  it("a human admin saves a configuration; the default rows are not stored; every change is audited with old and new value", async () => {
    await set(f.alice, projectA, [{ slot: "jira.label.moscow", enabled: false }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }, { slot: "jira.label.rank", enabled: true }]);
    expect(await stored(projectA)).toEqual([{ slot: "jira.dueDate", enabled: true, field_id: "customfield_10016" }, { slot: "jira.label.moscow", enabled: false, field_id: null }]);
    const a = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'tracker_field_config' and field in ('enabled','field_id') and entity_id in (select id from public.tracker_field_config where project_id = $1) order by id", [projectA]);
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.rows.every((r) => r.via === "UI" && r.actor_id === f.alice)).toBe(true);
    await set(f.alice, projectA, [{ slot: "jira.dueDate", enabled: true, field: "duedate-not-allowed-here" }].slice(0, 0));
    expect(await stored(projectA)).toEqual([]); // an empty list resets to the defaults
    const changes = await db.admin.query("select old, new from public.audit_log where entity = 'tracker_field_config' and field = 'enabled' and old = 'false'::jsonb");
    expect(changes.rows.length).toBeGreaterThan(0); // the reset is in the trail (old value false)
  });
  it("writes only what differs: saving the same configuration again adds no audit entry", async () => {
    await set(f.alice, projectA, [{ slot: "jira.label.type", enabled: false }]);
    const n = async () => (await db.admin.query("select count(*)::int n from public.audit_log where entity = 'tracker_field_config'")).rows[0].n as number;
    const before = await n();
    await set(f.alice, projectA, [{ slot: "jira.label.type", enabled: false }]);
    expect(await n()).toBe(before);
    await set(f.alice, projectA, []);
  });
  it("refuses a creator, a service account, Claude (MCP), another workspace's admin and a member of no workspace", async () => {
    const rows = [{ slot: "jira.label.moscow", enabled: false }];
    for (const who of [creator, service]) expect(await errorCode(set(who, projectA, rows)), who).toBe(DENIED);
    expect(await errorCode(set(f.alice, projectA, rows, "MCP")), "claude").toBe(DENIED);
    expect(await errorCode(set(f.alice, projectB, rows)), "other workspace").toBe(DENIED);
    expect(await errorCode(set(bob, projectA, rows)), "bob").toBe(DENIED);
    expect(await stored(projectA)).toEqual([]);
  });
  it("refuses a slot that is not on the closed list: fixed slots, commercial fields, another tracker's slots, bad fields", async () => {
    const bad: unknown[] = [
      [{ slot: "jira.summary", enabled: false }], [{ slot: "jira.description", enabled: false }], [{ slot: "value_12m", enabled: false }], [{ slot: "jira.value_12m", enabled: false }],
      [{ slot: "github.label.moscow", enabled: false }], [{ slot: "jira.label.moscow", enabled: false, field: "customfield_1" }], [{ slot: "jira.dueDate", enabled: true, field: "summary" }],
      [{ slot: "jira.dueDate", enabled: true, field: "customfield_1; drop table x" }], [{ slot: "jira.dueDate", enabled: false, field: "duedate" }],
      [{ slot: "jira.label.rank", enabled: false }, { slot: "jira.label.rank", enabled: false }], [{ slot: "jira.label.rank", enabled: "no" }], { slot: "jira.label.rank" }, [5], [{}],
    ];
    for (const rows of bad) expect(await errorCode(set(f.alice, projectA, rows)), JSON.stringify(rows)).toBe("22023");
    expect(await stored(projectA)).toEqual([]);
  });
  it("the Artifacts and Files sections of the Jira description can be switched off (migration jira_description_sections), the fixed sections can not", async () => {
    await set(f.alice, projectA, [{ slot: "jira.body.artifacts", enabled: false }, { slot: "jira.body.files", enabled: false }]);
    expect((await stored(projectA)).map((r) => r.slot)).toEqual(["jira.body.artifacts", "jira.body.files"]);
    for (const slot of ["jira.body.summary", "jira.body.hypothesis", "jira.description"]) expect(await errorCode(set(f.alice, projectA, [{ slot, enabled: false }])), slot).toBe("22023");
    await set(f.alice, projectA, []);
  });
  it("a project without a GitHub or Jira tracker is refused; GitHub slots work on a GitHub project", async () => {
    expect(await errorCode(set(f.alice, noTracker, [{ slot: "jira.label.rank", enabled: false }]))).toBe("P0002");
    await set(f.alice, githubProject, [{ slot: "github.milestone", enabled: false }, { slot: "github.body.files", enabled: false }]);
    expect((await stored(githubProject)).map((r) => r.slot)).toEqual(["github.body.files", "github.milestone"]);
    expect(await errorCode(set(f.alice, githubProject, [{ slot: "jira.label.rank", enabled: false }]))).toBe("22023");
    expect(await errorCode(set(f.alice, githubProject, [{ slot: "github.milestone", enabled: true, field: "customfield_1" }]))).toBe("22023");
    await set(f.alice, githubProject, []);
  });
  it("the table is read-only for signed-in users and invisible across workspaces", async () => {
    await set(f.alice, projectA, [{ slot: "jira.label.group", enabled: false }]);
    const mine = await db.asUser(f.alice, (q) => q("select slot from public.tracker_field_config where project_id = $1", [projectA]));
    expect(mine.rows.map((r: { slot: string }) => r.slot)).toEqual(["jira.label.group"]);
    const theirs = await db.asUser(bob, (q) => q("select slot from public.tracker_field_config where project_id = $1", [projectA]));
    expect(theirs.rows).toEqual([]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.tracker_field_config"), { commit: true }))).toBe(DENIED);
    await set(f.alice, projectA, []);
  });
});
