import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Epics coverage, GitHub twin (issue #465): the ticked repositories, the open parent issues last read, and who may change them.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let connA: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-gec@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  await db.admin.query("insert into public.github_repositories (tenant_id, connection_id, github_repo_id, full_name) values ($1, $2, 2, 'seed-org/web'), ($1, $2, 3, 'seed-org/gone')", [f.tenantA, connA]);
  await db.admin.query("update public.github_repositories set removed_at = now() where full_name = 'seed-org/gone' and tenant_id = $1", [f.tenantA]);
});
afterAll(async () => { await db.close(); });

const set = (who: string, repos: string[]) => db.asUser(who, async (q) => (await q("select public.github_set_epic_repos($1, $2::text[]) as r", [connA, repos])).rows[0].r as number, { commit: true });
const replace = (tenant: string, repo: string, rows: unknown[]) =>
  db.asService((q) => q("select public.github_replace_epics($1, $2, $3, $4::jsonb)", [tenant, connA, repo, JSON.stringify(rows)]), { commit: true });
const parent = (number: number, o: Record<string, unknown> = {}) => ({ number, title: `Parent ${number}`, type: "Epic", subs: 2, parent_repo: null, parent_number: null, url: `https://github.com/seed-org/web/issues/${number}`, updated: "2026-11-15T10:00:00Z", ...o });
const seen = async (tenant: string) => (await db.admin.query("select repo_full_name || '#' || issue_number as k from public.github_epics_seen where tenant_id = $1 order by 1", [tenant])).rows.map((r) => r.k as string);

describe("github_set_epic_repos", () => {
  it("lets an admin tick repositories and replaces the set; a creator and the other workspace's admin are refused", async () => {
    expect(await set(f.alice, ["seed-org/roadmap", "seed-org/web"])).toBe(2);
    expect(await errorCode(set(creator, ["seed-org/web"]))).toBe(DENIED);
    expect(await errorCode(set(f.bob, ["seed-org/web"]))).toBe(DENIED);
    expect(await set(f.alice, ["seed-org/web"])).toBe(1);
    const names = (await db.admin.query("select repo_full_name from public.github_epic_repos where tenant_id = $1 order by 1", [f.tenantA])).rows.map((r) => r.repo_full_name);
    expect(names).toEqual(["seed-org/web"]);
  });
  it("ticks by the name GitHub gave, whatever the case typed, and refuses a bad name, an unknown or removed repository, and more than 30", async () => {
    await set(f.alice, ["SEED-ORG/Web"]);
    expect((await db.admin.query("select repo_full_name from public.github_epic_repos where tenant_id = $1", [f.tenantA])).rows.map((r) => r.repo_full_name)).toEqual(["seed-org/web"]);
    expect(await errorCode(set(f.alice, ["bad name"]))).toBe("22023");
    expect(await errorCode(set(f.alice, ["seed-org/unknown"]))).toBe("22023");
    expect(await errorCode(set(f.alice, ["seed-org/gone"]))).toBe("22023");
    expect(await errorCode(set(f.alice, Array.from({ length: 31 }, (_, i) => `o/r${i}`)))).toBe("22023");
  });
  it("unticking a repository drops the issues read from it", async () => {
    await set(f.alice, ["seed-org/roadmap", "seed-org/web"]);
    await replace(f.tenantA, "seed-org/web", [parent(5)]);
    await set(f.alice, ["seed-org/roadmap"]);
    expect(await seen(f.tenantA)).not.toContain("seed-org/web#5");
  });
  it("is audited as the person", async () => {
    await set(f.alice, ["seed-org/web"]);
    const { rows } = await db.admin.query("select actor_id from public.audit_log where tenant_id = $1 and entity = 'github_epic_repos' order by at desc, id desc limit 1", [f.tenantA]);
    expect(rows[0]?.actor_id).toBe(f.alice);
  });
});

describe("github_replace_epics", () => {
  it("stores the open parent issues of a ticked repository, keeps the parent link, and removes the ones no longer listed", async () => {
    await set(f.alice, ["seed-org/web"]);
    await replace(f.tenantA, "seed-org/web", [parent(1), parent(2, { parent_repo: "seed-org/roadmap", parent_number: 9 })]);
    expect(await seen(f.tenantA)).toEqual(["seed-org/web#1", "seed-org/web#2"]);
    const { rows } = await db.admin.query("select parent_repo, parent_number from public.github_epics_seen where tenant_id = $1 and issue_number = 2", [f.tenantA]);
    expect(rows[0]).toEqual({ parent_repo: "seed-org/roadmap", parent_number: 9 });
    await replace(f.tenantA, "seed-org/web", [parent(2)]);
    expect(await seen(f.tenantA)).toEqual(["seed-org/web#2"]);
    await replace(f.tenantA, "seed-org/web", []);
    expect(await seen(f.tenantA)).toEqual([]);
  });
  it("refuses a repository that is not ticked, and keeps another workspace's rows apart", async () => {
    expect(await errorCode(replace(f.tenantA, "seed-org/roadmap-not-ticked", [parent(1)]))).toBe("22023");
    await set(f.alice, ["seed-org/web"]);
    await replace(f.tenantA, "seed-org/web", [parent(7)]);
    expect(await seen(f.tenantB)).toEqual(["seed-org/roadmap#20"]); // only its own seeded row
  });
  it("is not callable by a signed-in person", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.github_replace_epics($1, $2, 'seed-org/web', '[]'::jsonb)", [f.tenantA, connA]), { commit: true }))).toBe(DENIED);
  });
});
