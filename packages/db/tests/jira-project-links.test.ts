import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
const DENIED = "42501";
const GUARD = "PV008";
const UNAVAILABLE = "PV009";
const UNIQUE = "23505";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-jl@example.test");
  service = await createUser(db, "service-jl@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  // the fixture seeds one link per workspace; these tests start without it
  await db.admin.query("delete from public.jira_project_links");
});
afterAll(async () => {
  await db.close();
});

// fresh projects: the seeded one already has GitHub links, which the tracker guard (PV008) protects
let n = 0;
const newProject = async (tenant: string, name: string) => (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, name])).rows[0].id as string;
const projectOf = (tenant: string) => newProject(tenant, `Jira test ${++n}`);
const connOf = async (tenant: string) => (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected' limit 1", [tenant])).rows[0].id as string;
const tracker = async (project: string) => (await db.admin.query("select tracker from public.projects where id = $1", [project])).rows[0].tracker as string | null;
const links = async (project: string) => (await db.admin.query("select * from public.jira_project_links where project_id = $1", [project])).rows;
const reset = async () => {
  await db.admin.query("delete from public.jira_project_links");
  await db.admin.query("update public.projects set tracker = null where tracker = 'jira'");
};

const link = (user: string, project: string, conn: string, o: { site?: string; jiraId?: string; key?: string; epic?: boolean; via?: string } = {}) =>
  db.asUser(
    user,
    async (q) =>
      (await q("select public.jira_link_project($1, $2, $3, $4, $5, $6, '10001', 'Epic', $7, $8, null, null) as id", [
        project, conn, o.site ?? "site-1", o.jiraId ?? "10000", o.key ?? "PLAT", "Platform", o.epic === false ? null : "10002", o.epic === false ? null : "Story",
      ])).rows[0].id as string,
    { commit: true, via: o.via ?? "UI" },
  );
const unlink = (user: string, project: string) => db.asUser(user, (q) => q("select public.jira_unlink_project($1)", [project]), { commit: true });

describe("linking a project to a Jira project", () => {
  it("a human admin links it: the link records the project's own issue types, the project becomes a Jira project, the change is audited", async () => {
    await reset();
    const p = await projectOf(f.tenantA);
    const id = await link(f.alice, p, await connOf(f.tenantA));
    const [row] = await links(p);
    expect(row).toMatchObject({ id, jira_project_key: "PLAT", initiative_type_name: "Epic", epic_type_name: "Story", task_type_id: null, created_by: f.alice, created_via: "UI" });
    expect(await tracker(p)).toBe("jira");
    const audit = await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'jira_project_links' and entity_id = $1", [id]);
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });
  it("members can read the link and nobody writes the table directly", async () => {
    const p = (await db.admin.query("select project_id from public.jira_project_links where tenant_id = $1 limit 1", [f.tenantA])).rows[0].project_id as string;
    const rows = await db.asUser(f.alice, async (q) => (await q("select jira_project_key from public.jira_project_links where project_id = $1", [p])).rows);
    expect(rows).toHaveLength(1);
    let affected = 0;
    const code = await errorCode(db.asUser(f.alice, async (q) => { affected = (await q("update public.jira_project_links set jira_project_key = 'EVIL'")).rowCount ?? 0; }, { commit: true }));
    expect(code === DENIED || (code === null && affected === 0)).toBe(true);
  });
  it("creators, service accounts, Claude and admins of another workspace cannot link or unlink", async () => {
    await reset();
    const p = await projectOf(f.tenantA);
    const c = await connOf(f.tenantA);
    expect(await errorCode(link(creator, p, c))).toBe(DENIED);
    expect(await errorCode(link(service, p, c))).toBe(DENIED);
    expect(await errorCode(link(f.alice, p, c, { via: "Claude MCP" }))).toBe(DENIED);
    expect(await errorCode(link(f.bob, p, c))).toBe(DENIED);
    expect(await links(p)).toEqual([]);
    await link(f.alice, p, c);
    expect(await errorCode(unlink(creator, p))).toBe(DENIED);
    expect(await errorCode(unlink(f.bob, p))).toBe(DENIED);
    expect(await links(p)).toHaveLength(1);
  });
  it("refuses another workspace's connection, a site the connection does not reach, and a disconnected connection", async () => {
    await reset();
    const p = await projectOf(f.tenantA);
    expect(await errorCode(link(f.alice, p, await connOf(f.tenantB)))).toBe(UNAVAILABLE);
    expect(await errorCode(link(f.alice, p, await connOf(f.tenantA), { site: "other-site" }))).toBe(UNAVAILABLE);
    const dead = (await db.admin.query("insert into public.jira_connections (tenant_id, sites, state) values ($1, '[{\"id\":\"site-1\"}]'::jsonb, 'disconnected') returning id", [f.tenantA])).rows[0].id as string;
    expect(await errorCode(link(f.alice, p, dead))).toBe(UNAVAILABLE);
    expect(await links(p)).toEqual([]);
  });
  it("refuses a project that uses GitHub", async () => {
    await reset();
    const p = await projectOf(f.tenantA);
    await db.admin.query("update public.projects set tracker = 'github' where id = $1", [p]);
    expect(await errorCode(link(f.alice, p, await connOf(f.tenantA)))).toBe(GUARD);
    expect(await links(p)).toEqual([]);
  });
  it("linking again replaces the link; a Jira project backs only one project of the workspace", async () => {
    await reset();
    const p = await projectOf(f.tenantA);
    const p2 = await newProject(f.tenantA, "Second");
    const c = await connOf(f.tenantA);
    await link(f.alice, p, c, { key: "PLAT" });
    await link(f.alice, p, c, { key: "PLAT", epic: false });
    expect((await links(p)).map((r) => r.epic_type_id)).toEqual([null]);
    expect(await errorCode(link(f.alice, p2, c, { key: "PLAT" }))).toBe(UNIQUE);
    await link(f.alice, p2, c, { jiraId: "10005", key: "OTHER" });
    expect(await tracker(p2)).toBe("jira");
  });
  it("unlinking removes the link and releases the project", async () => {
    await reset();
    const p = await projectOf(f.tenantA);
    await link(f.alice, p, await connOf(f.tenantA));
    await unlink(f.alice, p);
    expect(await links(p)).toEqual([]);
    expect(await tracker(p)).toBeNull();
  });
  it("disconnecting the connection removes its links and releases the projects", async () => {
    await reset();
    const p = await projectOf(f.tenantB);
    const c = await connOf(f.tenantB);
    await link(f.bob, p, c);
    expect(await tracker(p)).toBe("jira");
    await db.asUser(f.bob, (q) => q("select public.jira_disconnect($1)", [c]), { commit: true });
    expect(await links(p)).toEqual([]);
    expect(await tracker(p)).toBeNull();
  });
  it("only a link in the same workspace as its project and connection can exist", async () => {
    await reset();
    const pA = await projectOf(f.tenantA);
    const cB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id as string;
    expect(await errorCode(db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 's', '1', 'AB', 'x', '1', 'Epic')", [f.tenantA, pA, cB]))).toBe("23503");
  });
});
