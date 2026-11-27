import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue 738: jira_status_sync / jira_set_status_sync (Initiative Status to the Jira workflow status, per project, OFF unless a row exists). Two tenants (rule 1).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string, bob: string;
let projectA: string, projectB: string, githubProject: string;
const DENIED = "42501";
const BAD = "22023";
const map = { Backlog: "10000", Active: "10001", "On hold": "10002", Completed: "10003", Cancelled: "10004" };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-jss@example.test");
  service = await createUser(db, "service-jss@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  bob = f.bob;
  projectA = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Status A', 'jira') returning id", [f.tenantA])).rows[0].id as string;
  projectB = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Status B', 'jira') returning id", [f.tenantB])).rows[0].id as string;
  githubProject = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'GH status', 'github') returning id", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

const set = (user: string, project: string, statuses: unknown, via = "UI") => db.asUser(user, (q) => q("select public.jira_set_status_sync($1, $2::jsonb)", [project, JSON.stringify(statuses)]), { commit: true, via });
const stored = async (project: string) => (await db.admin.query("select statuses from public.jira_status_sync where project_id = $1", [project])).rows.map((r) => r.statuses as Record<string, string>);

describe("jira_set_status_sync", () => {
  it("a human admin switches it on with a mapping; the change is audited as the person with source UI; the same mapping again adds nothing", async () => {
    await set(f.alice, projectA, map);
    expect(await stored(projectA)).toEqual([map]);
    const n = async () => (await db.admin.query("select count(*)::int n from public.audit_log where entity = 'jira_status_sync' and via = 'UI' and actor_id = $1", [f.alice])).rows[0].n as number;
    const before = await n();
    expect(before).toBeGreaterThan(0);
    await set(f.alice, projectA, map);
    expect(await n()).toBe(before);
    await set(f.alice, projectA, { ...map, Active: "10009" });
    expect((await stored(projectA))[0]!.Active).toBe("10009");
  });
  it("an empty mapping switches it off (the row is removed)", async () => {
    await set(f.alice, projectA, {});
    expect(await stored(projectA)).toEqual([]);
    await set(f.alice, projectA, map);
    await set(f.alice, projectA, null);
    expect(await stored(projectA)).toEqual([]);
  });
  it("a value may be left unmapped (Jira is then left alone for it)", async () => {
    await set(f.alice, projectA, { Active: "10001" });
    expect(await stored(projectA)).toEqual([{ Active: "10001" }]);
    await set(f.alice, projectA, {});
  });
  it("refuses a creator, a service account, Claude (MCP), another workspace's admin and a non-member", async () => {
    for (const who of [creator, service]) expect(await errorCode(set(who, projectA, map)), who).toBe(DENIED);
    expect(await errorCode(set(f.alice, projectA, map, "MCP")), "claude").toBe(DENIED);
    expect(await errorCode(set(f.alice, projectB, map)), "other workspace").toBe(DENIED);
    expect(await errorCode(set(bob, projectA, map)), "bob").toBe(DENIED);
    expect(await stored(projectA)).toEqual([]);
  });
  it("refuses a value that is not an Initiative Status (Build Status words included), a status id that is not a number, and a non-object", async () => {
    for (const bad of [{ "Not started": "1" }, { Done: "1" }, { Active: "abc" }, { Active: 1 }, { Active: "1; drop" }, [map], "x"]) expect(await errorCode(set(f.alice, projectA, bad)), JSON.stringify(bad)).toBe(BAD);
    expect(await stored(projectA)).toEqual([]);
  });
  it("refuses a project without a Jira tracker", async () => {
    expect(await errorCode(set(f.alice, githubProject, map))).toBe("P0002");
  });
  it("members read their own workspace's mapping and never another's (RLS); nobody writes the table directly", async () => {
    await set(f.alice, projectA, map);
    expect((await db.asUser(creator, (q) => q("select statuses from public.jira_status_sync where project_id = $1", [projectA]))).rows).toHaveLength(1);
    expect((await db.asUser(bob, (q) => q("select statuses from public.jira_status_sync where project_id = $1", [projectA]))).rows).toEqual([]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.jira_status_sync set statuses = '{\"Active\":\"1\"}' where project_id = $1", [projectA]), { commit: true }))).toBe(DENIED);
    await set(f.alice, projectA, {});
  });
});
