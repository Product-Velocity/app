import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, type TestDb } from "./helpers";

// An initiative pushed from PV creates its issue in GitHub; GitHub announces the new issue before PV has saved the link, so the
// issue is first recorded as "Not pulled" (Incoming). Pulling it in then failed with "Could not create the initiative".
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, connA: string, projectA: string;

const row = (number: number) => ({ repo: "Acme/App", number, id: 8000 + number, title: `R-${number}: pushed from PV`, type: null, labels: [], state: "open", reason: null, parent: null, url: `https://github.com/Acme/App/issues/${number}`, updated_at: "2026-10-27T10:00:00Z" });
const upsert = (rows: unknown[]) => db.asService((q) => q("select public.tracker_upsert_issues($1, $2::jsonb) as n", [connA, JSON.stringify(rows)]), { commit: true, via: "GitHub webhook" });
const get = async (n: number) => (await db.admin.query("select * from public.tracker_issues where connection_id = $1 and issue_number = $2", [connA, n])).rows[0];
const newItem = async (name: string) => (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name) values ($1, $2, $3) returning id, item_code", [f.tenantA, projectA, name])).rows[0] as { id: string; item_code: string };
const push = (item: string, n: number) =>
  db.asService((q) => q("select public.github_record_push($1, $2, $3, 'Acme/App', $4, $5, 'node', $6, 'h1', 'synced', null)", [creator, item, connA, n, 8000 + n, `https://github.com/Acme/App/issues/${n}`]), { commit: true, via: "UI" });
const pullIn = (id: string) => db.asUser(creator, async (q) => (await q("select * from public.tracker_pull_in($1::uuid[], $2)", [[id], projectA])).rows[0], { commit: true });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-race@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await db.admin.query("delete from public.tracker_issues");
  await db.admin.query("delete from public.item_github_links");
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1", [f.tenantA])).rows[0].id;
  projectA = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
});
afterAll(async () => { await db.close(); });

describe("an issue that PV pushed is not left in Incoming", () => {
  it("saving the link marks the already-recorded issue as pulled, with its initiative", async () => {
    await upsert([row(175)]); // the webhook arrives first
    expect((await get(175)).pull_state).toBe("not_pulled");
    const item = await newItem("Pushed first");
    await push(item.id, 175); // then PV saves the link
    expect(await get(175)).toMatchObject({ pull_state: "pulled", item_id: item.id });
  });
  it("a record that was left behind is repaired by the next check of GitHub", async () => {
    await upsert([row(176)]);
    const item = await newItem("Linked behind the scenes");
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', 176, 8176, 'https://github.com/Acme/App/issues/176', 'synced', 'push')", [f.tenantA, item.id, connA]);
    expect((await get(176)).pull_state).toBe("not_pulled"); // stale
    await upsert([row(176)]);
    expect(await get(176)).toMatchObject({ pull_state: "pulled", item_id: item.id });
  });
  it("pulling in an issue that already has an initiative says so, names the initiative and fixes the record", async () => {
    await upsert([row(177)]);
    const item = await newItem("Already there");
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', 177, 8177, 'https://github.com/Acme/App/issues/177', 'synced', 'push')", [f.tenantA, item.id, connA]);
    const r = await pullIn((await get(177)).id);
    expect(r).toMatchObject({ ok: false, reason: `Already linked to ${item.item_code}.` });
    expect(await get(177)).toMatchObject({ pull_state: "pulled", item_id: item.id });
    expect((await db.admin.query("select count(*)::int as n from public.items where tenant_id = $1 and source = 'GitHub issue #177'", [f.tenantA])).rows[0].n).toBe(0); // no second initiative
  });
  it("a genuinely new issue is still pulled in as before", async () => {
    await upsert([row(178)]);
    const r = await pullIn((await get(178)).id);
    expect(r).toMatchObject({ ok: true });
    expect(await get(178)).toMatchObject({ pull_state: "pulled" });
  });
});
