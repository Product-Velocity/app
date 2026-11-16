import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Epics coverage (issue #464): the ticked projects, the epics last read, and who may change them.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let connA: string;
let connB: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-ec@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

const set = (who: string, conn: string, keys: string[]) => db.asUser(who, async (q) => (await q("select public.jira_set_epic_projects($1, 'site-1', $2::text[]) as r", [conn, keys])).rows[0].r as number, { commit: true });
const replace = (tenant: string, conn: string, project: string, rows: unknown[]) =>
  db.asService((q) => q("select public.jira_replace_epics($1, $2, 'site-1', $3, $4::jsonb)", [tenant, conn, project, JSON.stringify(rows)]), { commit: true });
const epic = (key: string, o: Record<string, unknown> = {}) => ({ key, title: `Epic ${key}`, status: "In Progress", category: "indeterminate", parent: null, url: `https://x.atlassian.net/browse/${key}`, updated: "2026-11-15T10:00:00Z", ...o });
const seen = async (tenant: string) => (await db.admin.query("select issue_key, project_key from public.jira_epics_seen where tenant_id = $1 order by issue_key", [tenant])).rows.map((r) => r.issue_key as string);

describe("jira_set_epic_projects", () => {
  it("lets an admin tick projects and replaces the set; a creator and the other workspace's admin are refused", async () => {
    expect(await set(f.alice, connA, ["AAA", "BBB"])).toBe(2);
    expect(await errorCode(set(creator, connA, ["CCC"]))).toBe(DENIED);
    expect(await errorCode(set(f.bob, connA, ["CCC"]))).toBe(DENIED);
    expect(await set(f.alice, connA, ["BBB", "CCC"])).toBe(2);
    const keys = (await db.admin.query("select project_key from public.jira_epic_projects where tenant_id = $1 order by 1", [f.tenantA])).rows.map((r) => r.project_key);
    expect(keys).toEqual(["BBB", "CCC"]);
  });
  it("refuses a bad key and more than 30 projects", async () => {
    expect(await errorCode(set(f.alice, connA, ["bad key"]))).toBe("22023");
    expect(await errorCode(set(f.alice, connA, Array.from({ length: 31 }, (_, i) => `P${i + 10}`)))).toBe("22023");
  });
  it("unticking a project drops the epics read from it", async () => {
    await set(f.alice, connA, ["BBB", "CCC"]);
    await replace(f.tenantA, connA, "CCC", [epic("CCC-1")]);
    await set(f.alice, connA, ["BBB"]);
    expect(await seen(f.tenantA)).not.toContain("CCC-1");
  });
});

describe("jira_replace_epics", () => {
  it("stores the epics of a ticked project and removes the ones no longer open", async () => {
    await set(f.alice, connA, ["BBB"]);
    await replace(f.tenantA, connA, "BBB", [epic("BBB-1"), epic("BBB-2", { parent: "AAA-9" })]);
    expect(await seen(f.tenantA)).toEqual(["BBB-1", "BBB-2"]);
    await replace(f.tenantA, connA, "BBB", [epic("BBB-2")]);
    expect(await seen(f.tenantA)).toEqual(["BBB-2"]);
    await replace(f.tenantA, connA, "BBB", []);
    expect(await seen(f.tenantA)).toEqual([]);
  });
  it("refuses a project that is not ticked, and keeps another workspace's rows apart", async () => {
    expect(await errorCode(replace(f.tenantA, connA, "ZZZ", [epic("ZZZ-1")]))).toBe("22023");
    await set(f.alice, connA, ["BBB"]);
    await replace(f.tenantA, connA, "BBB", [epic("BBB-5")]);
    expect(await seen(f.tenantB)).toEqual(["SEED-20"]); // only its own seeded row, none of tenant A's
    expect(connB).not.toBe(connA);
  });
  it("is not callable by a signed-in person", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_replace_epics($1, $2, 'site-1', 'BBB', '[]'::jsonb)", [f.tenantA, connA]), { commit: true }))).toBe(DENIED);
  });
});
