import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
let conn: string;
let n = 0;
const DENIED = "42501";
const GUARD = "PV008";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-pi@example.test");
  service = await createUser(db, "service-pi@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  conn = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

/** A project linked to Jira project KEYn with its tracker set, as slice B leaves it. */
async function jiraProject(tenant = f.tenantA, connection = conn) {
  const key = `PI${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 'site-1', $4, $5, 'x', '1', 'Epic')", [tenant, p, connection, String(1000 + n), key]);
  await db.admin.query("update public.projects set tracker = 'jira' where id = $1", [p]);
  return { project: p, key };
}
async function issue(project: string, key: string, num: number, category: string | null = "new", tenant = f.tenantA, connection = conn) {
  return (await db.admin.query(
    "insert into public.jira_issues (tenant_id, connection_id, project_id, site_id, jira_project_key, issue_key, issue_id, title, status, status_category, html_url) values ($1, $2, $3, 'site-1', $4, $5, $6, $7, 'To Do', $8, $9) returning id",
    [tenant, connection, project, key, `${key}-${num}`, String(9000 + num), `Title ${key}-${num}`, category, `https://x.atlassian.net/browse/${key}-${num}`],
  )).rows[0].id as string;
}
const pull = (user: string, ids: string[], project: string, mode?: string, via = "UI") =>
  db.asUser(user, async (q) => (await q(mode ? "select * from public.jira_pull_in($1, $2, $3)" : "select * from public.jira_pull_in($1, $2)", mode ? [ids, project, mode] : [ids, project])).rows as { id: string; ok: boolean; reason: string | null; item_id: string | null; item_code: string | null }[], { commit: true, via });
const state = (user: string, ids: string[], s: string, reason?: string) =>
  db.asUser(user, async (q) => (await q("select * from public.jira_set_state($1, $2, $3)", [ids, s, reason ?? null])).rows as { id: string; ok: boolean; reason: string | null }[], { commit: true, via: "UI" });
const issueRow = async (id: string) => (await db.admin.query("select * from public.jira_issues where id = $1", [id])).rows[0];
const linkOf = async (item: string) => (await db.admin.query("select * from public.item_jira_links where item_id = $1", [item])).rows[0];
const itemOf = async (item: string) => (await db.admin.query("select initiative_name, source, status, home_project_id from public.items where id = $1", [item])).rows[0];

describe("pulling a Jira issue in", () => {
  it("a creator pulls it in read only: an initiative that follows the issue, Build Status from the status category, audited", async () => {
    const { project, key } = await jiraProject();
    const a = await issue(project, key, 1, "indeterminate");
    const [r] = await pull(creator, [a], project);
    expect(r).toMatchObject({ ok: true, reason: null });
    expect(r!.item_code).toBeTruthy();
    expect(await itemOf(r!.item_id!)).toMatchObject({ initiative_name: `Title ${key}-1`, source: `Jira issue ${key}-1`, status: "In progress", home_project_id: project });
    expect(await linkOf(r!.item_id!)).toMatchObject({ mode: "follow", issue_key: `${key}-1`, jira_status_category: "indeterminate", created_via: "UI" });
    expect(await issueRow(a)).toMatchObject({ pull_state: "pulled", item_id: r!.item_id });
    const audit = await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'jira_issues' and entity_id = $1 and field = 'pull_state'", [a]);
    expect(audit.rows[0].n).toBe(1);
  });
  it("a category of new starts as Not started; no category leaves Build Status empty", async () => {
    const { project, key } = await jiraProject();
    const [a, b] = [await issue(project, key, 1, "new"), await issue(project, key, 2, null)];
    const r = await pull(f.alice, [a, b], project);
    expect((await itemOf(r[0]!.item_id!)).status).toBe("Not started");
    expect((await itemOf(r[1]!.item_id!)).status).toBeNull();
  });
  it("Product Velocity can take ownership at pull-in (push); a wrong mode is refused", async () => {
    const { project, key } = await jiraProject();
    const a = await issue(project, key, 1);
    expect(await errorCode(pull(f.alice, [a], project, "weird"))).toBe("22023");
    const [r] = await pull(f.alice, [a], project, "push");
    expect((await linkOf(r!.item_id!)).mode).toBe("push");
  });
  it("pulling the same issue twice makes one initiative; an issue of another project is refused", async () => {
    const one = await jiraProject();
    const two = await jiraProject();
    const a = await issue(one.project, one.key, 1);
    const [first] = await pull(f.alice, [a], one.project);
    const [again] = await pull(f.alice, [a], one.project);
    expect(first!.ok).toBe(true);
    expect(again).toMatchObject({ ok: false, reason: "Already an initiative." });
    const b = await issue(two.project, two.key, 1);
    expect((await pull(f.alice, [b], one.project))[0]).toMatchObject({ ok: false, reason: "This issue belongs to another project." });
  });
  it("viewers, other workspaces and projects that are not linked to Jira cannot pull in", async () => {
    const { project, key } = await jiraProject();
    const a = await issue(project, key, 1);
    expect(await errorCode(pull(f.carol, [a], project))).toBe(DENIED);
    expect(await errorCode(pull(f.bob, [a], project))).toBe(DENIED);
    const plain = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'Plain') returning id", [f.tenantA])).rows[0].id as string;
    expect(await errorCode(pull(f.alice, [a], plain))).toBe(GUARD);
    expect((await issueRow(a)).pull_state).toBe("not_pulled");
  });
});

describe("ignoring and un-ignoring", () => {
  it("an editor ignores with a reason and brings it back; a pulled issue cannot be ignored; a viewer cannot", async () => {
    const { project, key } = await jiraProject();
    const [a, b] = [await issue(project, key, 1), await issue(project, key, 2)];
    expect((await state(creator, [a], "ignored", "noise"))[0]).toMatchObject({ ok: true });
    expect(await issueRow(a)).toMatchObject({ pull_state: "ignored", ignore_reason: "noise" });
    expect((await state(creator, [a], "not_pulled"))[0]!.ok).toBe(true);
    expect((await issueRow(a)).ignore_reason).toBeNull();
    await pull(creator, [b], project);
    expect((await state(creator, [b], "ignored"))[0]).toMatchObject({ ok: false });
    expect((await state(f.carol, [a], "ignored"))[0]).toMatchObject({ ok: false, reason: "You cannot change this issue." });
    expect(await errorCode(state(creator, [a], "pulled"))).toBe("22023");
  });
});

describe("who owns a linked initiative", () => {
  it("an editor changes the mode and gets the old one back; the change is audited; service accounts cannot", async () => {
    const { project, key } = await jiraProject();
    const [r] = await pull(creator, [await issue(project, key, 1)], project);
    const set = (u: string, m: string) => db.asUser(u, async (q) => (await q("select public.item_set_jira_link_mode($1, $2) as m", [r!.item_id, m])).rows[0].m as string, { commit: true, via: "UI" });
    expect(await set(creator, "push")).toBe("follow");
    expect((await linkOf(r!.item_id!)).mode).toBe("push");
    const a = await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'item_jira_links' and field = 'mode' and new = '\"push\"'::jsonb");
    expect(a.rows[0].n).toBeGreaterThan(0);
    expect(await errorCode(set(service, "follow"))).toBe(DENIED);
    expect(await errorCode(set(f.carol, "follow"))).toBe(DENIED);
  });
  it("an initiative with a GitHub link cannot also get a Jira link", async () => {
    const { project, key } = await jiraProject();
    void key;
    const item = (await db.admin.query("select item_id from public.item_github_links where tenant_id = $1 limit 1", [f.tenantA])).rows[0].item_id as string;
    void project;
    expect(await errorCode(db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key) values ($1, $2, $3, 'site-1', 'ZZ-1')", [f.tenantA, item, conn]))).toBe(GUARD);
  });
});

describe("projects with linked initiatives", () => {
  it("cannot be unlinked until the initiatives are removed; unlinking an empty one clears its read list", async () => {
    const used = await jiraProject();
    await pull(f.alice, [await issue(used.project, used.key, 1)], used.project);
    const unlink = (p: string) => db.asUser(f.alice, (q) => q("select public.jira_unlink_project($1)", [p]), { commit: true, via: "UI" });
    expect(await errorCode(unlink(used.project))).toBe(GUARD);
    const empty = await jiraProject();
    const kept = await issue(empty.project, empty.key, 1);
    await unlink(empty.project);
    expect((await db.admin.query("select count(*)::int as n from public.jira_issues where id = $1", [kept])).rows[0].n).toBe(0);
    expect((await db.admin.query("select tracker from public.projects where id = $1", [empty.project])).rows[0].tracker).toBeNull();
  });
  it("disconnecting keeps the link and the tracker of a project that has linked initiatives, and releases the others", async () => {
    const c = (await db.admin.query("insert into public.jira_connections (tenant_id, sites, state) values ($1, '[{\"id\":\"site-1\"}]'::jsonb, 'connected') returning id", [f.tenantA])).rows[0].id as string;
    const used = await jiraProject(f.tenantA, c);
    const free = await jiraProject(f.tenantA, c);
    await pull(f.alice, [await issue(used.project, used.key, 1, "new", f.tenantA, c)], used.project);
    await issue(free.project, free.key, 1, "new", f.tenantA, c);
    await db.asUser(f.alice, (q) => q("select public.jira_disconnect($1)", [c]), { commit: true, via: "UI" });
    const tr = async (p: string) => (await db.admin.query("select tracker from public.projects where id = $1", [p])).rows[0].tracker as string | null;
    expect(await tr(used.project)).toBe("jira");
    expect(await tr(free.project)).toBeNull();
    expect((await db.admin.query("select count(*)::int as n from public.jira_project_links where project_id = $1", [used.project])).rows[0].n).toBe(1);
    expect((await db.admin.query("select count(*)::int as n from public.jira_project_links where project_id = $1", [free.project])).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int as n from public.jira_issues where connection_id = $1 and pull_state <> 'pulled'", [c])).rows[0].n).toBe(0);
  });
});
