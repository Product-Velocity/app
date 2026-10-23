import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let github: string, jira: string, none: string, itemId: string, connA: string;
const PV008 = "PV008";

const codeOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { code?: string }).code ?? "unknown"; } };
const tracker = async (id: string) => (await db.admin.query("select tracker from public.projects where id = $1", [id])).rows[0].tracker as string | null;
const newProject = async (name: string, t: string | null) => (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, $2, $3) returning id", [f.tenantA, name, t])).rows[0].id as string;
const newItem = async (project: string, name: string) => (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name) values ($1, $2, $3) returning id", [f.tenantA, project, name])).rows[0].id as string;
const link = (item: string, n: number) => db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, $6, 'synced', 'follow')", [f.tenantA, item, connA, n, 9000 + n, `https://github.com/Acme/App/issues/${n}`]);

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1", [f.tenantA])).rows[0].id;
  github = await newProject("Tracker GitHub", "github");
  jira = await newProject("Tracker Jira", "jira");
  none = await newProject("Tracker None", null);
  itemId = await newItem(jira, "Jira initiative");
});
afterAll(async () => {
  await db.close();
});

describe("a project has one delivery tracker", () => {
  it("an initiative of a Jira project cannot link to GitHub", async () => {
    expect(await codeOf(link(itemId, 501))).toBe(PV008);
  });
  it("a project without a tracker becomes a GitHub project at its first GitHub link", async () => {
    const item = await newItem(none, "First link");
    expect(await tracker(none)).toBeNull();
    await link(item, 502);
    expect(await tracker(none)).toBe("github");
  });
  it("a linked initiative cannot be moved into a Jira project, an unlinked one can", async () => {
    const linked = await newItem(github, "Linked");
    await link(linked, 503);
    expect(await codeOf(db.admin.query("update public.items set home_project_id = $1 where id = $2", [jira, linked]))).toBe(PV008);
    const free = await newItem(github, "Free");
    await db.admin.query("update public.items set home_project_id = $1 where id = $2", [jira, free]);
    expect((await db.admin.query("select home_project_id from public.items where id = $1", [free])).rows[0].home_project_id).toBe(jira);
  });
  it("a project with GitHub links cannot change tracker, and a repository only belongs on a GitHub project", async () => {
    expect(await codeOf(db.admin.query("update public.projects set tracker = 'jira' where id = $1", [github]))).toBe(PV008);
    expect(await codeOf(db.admin.query("update public.projects set default_repo = 'seed-org/roadmap' where id = $1", [jira]))).toBe(PV008);
    await db.admin.query("update public.projects set tracker = 'gitlab' where id = $1", [await newProject("Empty", "github")]); // no links: free to change
  });
  it("a Jira project refuses to pull in an issue (Incoming), with the same code", async () => {
    // the function refuses before creating anything
    const ti = (await db.admin.query("insert into public.tracker_issues (tenant_id, connection_id, repo_full_name, issue_number, title) values ($1, $2, 'Acme/App', 510, 'Pull me') returning id", [f.tenantA, connA])).rows[0].id;
    const member = (await db.admin.query("select user_id from public.tenant_members where tenant_id = $1 and role = 'admin' limit 1", [f.tenantA])).rows[0].user_id;
    expect(await codeOf(db.asUser(member, (q) => q("select * from public.tracker_pull_in($1::uuid[], $2)", [[ti], jira])))).toBe(PV008);
    expect((await db.admin.query("select pull_state from public.tracker_issues where id = $1", [ti])).rows[0].pull_state).toBe("not_pulled");
  });
});
