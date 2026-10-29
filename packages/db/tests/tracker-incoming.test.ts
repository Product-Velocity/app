import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, connA: string, projectA: string, projectB: string, itemA: string;
const DENIED = "42501";
const T1 = "2026-10-23T10:00:00Z", T2 = "2026-10-23T11:00:00Z";

const row = (number: number, o: Record<string, unknown> = {}) => ({ repo: "Acme/App", number, id: 7000 + number, title: `Issue ${number}`, type: null, labels: [], state: "open", reason: null, parent: null, url: `https://github.com/Acme/App/issues/${number}`, updated_at: T1, ...o });
const upsert = (rows: unknown[], conn = connA) => db.asService((q) => q("select public.tracker_upsert_issues($1, $2::jsonb) as n", [conn, JSON.stringify(rows)]), { commit: true, via: "GitHub webhook" });
const get = async (n: number) => (await db.admin.query("select * from public.tracker_issues where connection_id = $1 and issue_number = $2", [connA, n])).rows[0];
const idOf = async (n: number) => (await get(n)).id as string;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-incoming@example.test");
  viewer = await createUser(db, "viewer-incoming@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await db.admin.query("delete from public.tracker_issues");
  await db.admin.query("delete from public.tracker_rules");
  await db.admin.query("delete from public.item_github_links");
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1", [f.tenantA])).rows[0].id;
  projectA = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  projectB = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  itemA = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("new arrivals", () => {
  it("start as Not pulled, an issue that already has an initiative is Pulled, and the children in an initiative's tree are not incoming", async () => {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', 31, 7031, 'https://github.com/Acme/App/issues/31', 'synced', 'follow')", [f.tenantA, itemA, connA]);
    await db.admin.query("insert into public.item_issue_tree (tenant_id, item_id, repo_full_name, issue_number, level, title, state) values ($1, $2, 'Acme/App', 50, 1, 'An epic', 'open')", [f.tenantA, itemA]);
    await upsert([row(30), row(31), row(50)]);
    expect(await get(30)).toMatchObject({ pull_state: "not_pulled", title: "Issue 30" });
    expect(await get(31)).toMatchObject({ pull_state: "pulled", item_id: itemA });
    expect(await get(50)).toBeUndefined();
  });

  it("a rule decides only for new arrivals; known issues and pulled-in ones are untouched", async () => {
    await upsert([row(40, { type: "Bug" })]); // no rule yet
    expect((await get(40)).pull_state).toBe("not_pulled");
    await db.asUser(f.alice, (q) => q("select public.tracker_rule_add($1, 'type', 'Bug')", [connA]), { commit: true });
    await db.asUser(f.alice, (q) => q("select public.tracker_rule_add($1, 'label', 'support')", [connA]), { commit: true });
    await upsert([row(41, { type: "Bug" }), row(42, { labels: ["Support"] }), row(43, { type: "Feature" }), row(40, { type: "Bug", updated_at: T2 })]);
    expect(await get(41)).toMatchObject({ pull_state: "ignored", ignore_reason: "Rule: type Bug" });
    expect(await get(42)).toMatchObject({ pull_state: "ignored", ignore_reason: "Rule: label support" });
    expect((await get(43)).pull_state).toBe("not_pulled");
    expect((await get(40)).pull_state).toBe("not_pulled"); // already known: the rule does not reach back
  });

  it("a sync refreshes the light fields, never the choice, and older information is ignored", async () => {
    const id43_56 = await idOf(43);
    await db.asUser(creator, (q) => q("select * from public.tracker_set_state($1::uuid[], 'ignored', 'chore')", [[id43_56]]), { commit: true });
    await upsert([row(43, { title: "Renamed", state: "closed", reason: "completed", updated_at: T2 })]);
    expect(await get(43)).toMatchObject({ pull_state: "ignored", title: "Renamed", state: "closed" });
    await upsert([row(43, { title: "Old name", updated_at: T1 })]);
    expect((await get(43)).title).toBe("Renamed");
  });

  it("the rules are tenant data: admins change them, others cannot", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.tracker_rule_add($1, 'type', 'Task')", [connA])))).toBe(DENIED);
    const id = (await db.admin.query("select id from public.tracker_rules where connection_id = $1 and kind = 'label'", [connA])).rows[0].id;
    expect(await errorCode(db.asUser(creator, (q) => q("select public.tracker_rule_remove($1)", [id])))).toBe(DENIED);
    await db.asUser(f.alice, (q) => q("select public.tracker_rule_remove($1)", [id]), { commit: true });
    await upsert([row(44, { labels: ["support"] })]);
    expect((await get(44)).pull_state).toBe("not_pulled"); // a removed rule no longer applies
  });
});

describe("choosing", () => {
  it("ignore, bring back, ignore again: all audited, in one call per batch; viewers cannot", async () => {
    const ids = [await idOf(30), await idOf(44)];
    const denied = await db.asUser(viewer, (q) => q("select * from public.tracker_set_state($1::uuid[], 'ignored', 'x')", [ids]));
    expect(denied.rows.every((x) => !x.ok)).toBe(true);
    await db.asUser(creator, (q) => q("select * from public.tracker_set_state($1::uuid[], 'ignored', 'support request')", [ids]), { commit: true });
    expect(await get(30)).toMatchObject({ pull_state: "ignored", ignore_reason: "support request" });
    await db.asUser(creator, (q) => q("select * from public.tracker_set_state($1::uuid[], 'not_pulled')", [ids]), { commit: true });
    expect(await get(30)).toMatchObject({ pull_state: "not_pulled", ignore_reason: null });
    await db.asUser(creator, (q) => q("select * from public.tracker_set_state($1::uuid[], 'ignored', 'again')", [ids]), { commit: true });
    const audit = await db.admin.query("select old, new, actor_id, via from public.audit_log where entity = 'tracker_issues' and entity_id = $1 and field = 'pull_state' order by id", [ids[0]]);
    expect(audit.rows.map((r) => [r.old, r.new])).toEqual([["not_pulled", "ignored"], ["ignored", "not_pulled"], ["not_pulled", "ignored"]]);
    expect(audit.rows[0]).toMatchObject({ actor_id: creator, via: "UI" });
  });
});

describe("pull in", () => {
  it("creates an initiative that follows the issue read-only, keeps the key and link, and takes its status from the issue", async () => {
    await upsert([row(60, { state: "closed", reason: "completed", updated_at: T2 }), row(61)]);
    const ids = [await idOf(60), await idOf(61)];
    const r = await db.asUser(creator, (q) => q("select * from public.tracker_pull_in($1::uuid[], $2)", [ids, projectA]), { commit: true });
    expect(r.rows.every((x) => x.ok && x.item_id)).toBe(true);
    const t = await get(60);
    expect(t).toMatchObject({ pull_state: "pulled" });
    const item = (await db.admin.query("select initiative_name, source, status, home_project_id from public.items where id = $1", [t.item_id])).rows[0];
    expect(item).toMatchObject({ initiative_name: "Issue 60", source: "GitHub issue #60", status: "Done", home_project_id: projectA });
    const link = (await db.admin.query("select mode, issue_number, html_url, sync_state, gh_state from public.item_github_links where item_id = $1", [t.item_id])).rows[0];
    expect(link).toMatchObject({ mode: "follow", issue_number: 60, sync_state: "synced", gh_state: "closed_completed" });
    expect((await db.admin.query("select status from public.items where id = $1", [(await get(61)).item_id])).rows[0].status).toBe("Not started");
  });

  it("refuses what is already an initiative, a viewer, and another workspace's project", async () => {
    const id60_106 = await idOf(60);
    const again = await db.asUser(creator, (q) => q("select * from public.tracker_pull_in($1::uuid[], $2)", [[id60_106], projectA]), { commit: true });
    expect(again.rows[0]).toMatchObject({ ok: false });
    const id44_109 = await idOf(44);
    expect(await errorCode(db.asUser(viewer, (q) => q("select * from public.tracker_pull_in($1::uuid[], $2)", [[id44_109], projectA])))).toBe(DENIED);
    const id44_111 = await idOf(44);
    expect(await errorCode(db.asUser(creator, (q) => q("select * from public.tracker_pull_in($1::uuid[], $2)", [[id44_111], projectB])))).toBe(DENIED);
    const id60_113 = await idOf(60);
    const pulled = await db.asUser(creator, (q) => q("select * from public.tracker_set_state($1::uuid[], 'ignored')", [[id60_113]]), { commit: true });
    expect(pulled.rows[0]).toMatchObject({ ok: false });
  });

  it("undoing a pull-in (the new initiative is discarded) lets the issue go back to Not pulled", async () => {
    const id = await idOf(61);
    const item = (await get(61)).item_id as string;
    await db.admin.query("delete from public.items where id = $1", [item]);
    const r = await db.asUser(creator, (q) => q("select * from public.tracker_set_state($1::uuid[], 'not_pulled')", [[id]]), { commit: true });
    expect(r.rows[0]).toMatchObject({ ok: true });
    expect(await get(61)).toMatchObject({ pull_state: "not_pulled", item_id: null });
  });

  it("ignored and not-pulled issues have no item and no link, so nothing can be pushed or written to them", async () => {
    const stray = await db.admin.query(`select count(*)::int as n from public.tracker_issues t
      where t.pull_state <> 'pulled' and (t.item_id is not null or exists (select 1 from public.item_github_links l where l.connection_id = t.connection_id and lower(l.repo_full_name) = lower(t.repo_full_name) and l.issue_number = t.issue_number))`);
    expect(stray.rows[0].n).toBe(0);
  });
});

describe("a sync that finds nothing new writes nothing", () => {
  it("re-sending the same light record does not rewrite the row; a real change does", async () => {
    await upsert([row(80, { title: "Stable" })]);
    const before = await get(80);
    await new Promise((r) => setTimeout(r, 20));
    const written = await upsert([row(80, { title: "Stable" })]);
    expect(written.rows[0].n).toBe(0);
    expect((await get(80)).updated_at.getTime()).toBe(before.updated_at.getTime());
    const changed = await upsert([row(80, { title: "Edited", updated_at: T2 })]);
    expect(changed.rows[0].n).toBe(1);
    expect((await get(80)).title).toBe("Edited");
  });
});
