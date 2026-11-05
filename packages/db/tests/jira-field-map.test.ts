import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Jira field mapping per project (issue #67, #70): jira_set_field_map.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
let projectA: string, projectB: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-fm@example.test");
  service = await createUser(db, "service-fm@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  projectA = (await db.admin.query("select project_id from public.jira_project_links where tenant_id = $1", [f.tenantA])).rows[0].project_id as string;
  projectB = (await db.admin.query("select project_id from public.jira_project_links where tenant_id = $1", [f.tenantB])).rows[0].project_id as string;
});
afterAll(async () => { await db.close(); });

const set = (user: string, project: string, map: unknown, via = "UI") => db.asUser(user, (q) => q("select public.jira_set_field_map($1, $2::jsonb)", [project, JSON.stringify(map)]), { commit: true, via });
const stored = async (project: string) => (await db.admin.query("select field_map from public.jira_project_links where project_id = $1", [project])).rows[0].field_map;
const GOOD = { startDate: "customfield_10015", theme: "customfield_10030", focusArea: "customfield_10031", priorityByMoscow: { Must: "1", Should: "2", Could: "3", "Won't": "5" } };

describe("jira_set_field_map", () => {
  it("a human admin stores a valid mapping and the change is audited", async () => {
    await set(f.alice, projectA, GOOD);
    expect(await stored(projectA)).toEqual(GOOD);
    const a = await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'jira_project_links' and field = 'field_map'");
    expect(a.rows[0].n).toBeGreaterThan(0);
    await set(f.alice, projectA, {});
    expect(await stored(projectA)).toEqual({});
  });
  it("refuses a creator, a service account, Claude, another workspace's admin and a bad key or value", async () => {
    for (const who of [creator, service]) expect(await errorCode(set(who, projectA, GOOD)), who).toBe(DENIED);
    expect(await errorCode(set(f.alice, projectA, GOOD, "MCP")), "claude").toBe(DENIED);
    expect(await errorCode(set(f.alice, projectB, GOOD)), "other workspace").toBe(DENIED); // alice is not an admin of workspace B
    for (const bad of [{ summary: "x" }, { startDate: "duedate" }, { startDate: "customfield_1; drop" }, { theme: "summary" }, { theme: "customfield_1; drop" }, { theme: 10030 }, { focusArea: "summary" }, { focusArea: "customfield_1; drop" }, { focusArea: 10031 }, { theme: ["customfield_10030"] }, { priorityByMoscow: { Maybe: "1" } }, { priorityByMoscow: { Must: "High" } }, { priorityByMoscow: [] }, []]) {
      expect(await errorCode(set(f.alice, projectA, bad)), JSON.stringify(bad)).toBe("22023");
    }
    expect(await stored(projectA)).toEqual({});
  });
  it("a project without a Jira link is refused", async () => {
    const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'No link') returning id", [f.tenantA])).rows[0].id as string;
    expect(await errorCode(set(f.alice, p, GOOD))).toBe("P0002");
  });
});
