import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, source: string, target: string, projectB: string, itemB: string;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-copy@example.test");
  viewer = await createUser(db, "viewer-copy@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  const home = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  target = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, 'Jira mirror', 'jira') returning id", [f.tenantA])).rows[0].id;
  source = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, summary, moscow, decision, status, delivery_progress_pct, source) values ($1, $2, 'Original', 'A summary', 'Must', 'Go', 'Done', 100, 'GitHub issue #5') returning id", [f.tenantA, home])).rows[0].id;
  await db.admin.query("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'q1')", [f.tenantA, source]);
  await db.admin.query("insert into public.item_links (tenant_id, item_id, label, url) values ($1, $2, 'PRD', 'https://example.test/prd')", [f.tenantA, source]);
  await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) select $1, $2, c.id, 'Acme/App', 5, 5005, 'https://github.com/Acme/App/issues/5', 'synced', 'follow' from public.github_connections c where c.tenant_id = $1 limit 1", [f.tenantA, source]);
  projectB = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("copy initiatives to another project", () => {
  it("creates separate initiatives with the planning fields, tags and links, and nothing the tracker or a gate owns", async () => {
    const r = await db.asUser(creator, (q) => q("select * from public.copy_items_to_project($1::uuid[], $2)", [[source], target]), { commit: true });
    expect(r.rows[0]).toMatchObject({ ok: true });
    const c = (await db.admin.query("select * from public.items where id = $1", [r.rows[0].new_id])).rows[0];
    expect(c).toMatchObject({ home_project_id: target, initiative_name: "Original", summary: "A summary", moscow: "Must", decision: null, status: null, delivery_progress_pct: null });
    expect(c.source).toMatch(/^Copy of /);
    expect(c.item_code).not.toBe((await db.admin.query("select item_code from public.items where id = $1", [source])).rows[0].item_code);
    expect((await db.admin.query("select value from public.item_tags where item_id = $1", [c.id])).rows.map((x) => x.value)).toEqual(["q1"]);
    expect((await db.admin.query("select url from public.item_links where item_id = $1", [c.id])).rows.map((x) => x.url)).toEqual(["https://example.test/prd"]);
    expect((await db.admin.query("select count(*)::int as n from public.item_github_links where item_id = $1", [c.id])).rows[0].n).toBe(0);
    expect((await db.admin.query("select status, decision from public.items where id = $1", [source])).rows[0]).toMatchObject({ status: "Done", decision: "Go" }); // the original is untouched
  });
  it("a viewer cannot copy, another workspace's project or initiative is refused", async () => {
    expect(await errorCode(db.asUser(viewer, (q) => q("select * from public.copy_items_to_project($1::uuid[], $2)", [[source], target])))).toBe("42501");
    expect(await errorCode(db.asUser(creator, (q) => q("select * from public.copy_items_to_project($1::uuid[], $2)", [[source], projectB])))).toBe("42501");
    const r = await db.asUser(creator, (q) => q("select * from public.copy_items_to_project($1::uuid[], $2)", [[itemB], target]));
    expect(r.rows[0]).toMatchObject({ ok: false, new_id: null });
  });
});
