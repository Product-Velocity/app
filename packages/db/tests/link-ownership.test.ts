import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Request 253, issue #256: who owns a pulled-in item. Read only ('follow') or Product Velocity ('push').
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string, connA: string, projectA: string, itemA: string, itemB: string;
const DENIED = "42501";

const link = async (item: string) => (await db.admin.query("select mode, sync_state, last_pushed_hash from public.item_github_links where item_id = $1", [item])).rows[0];
const issue = (number: number) => ({ repo: "Acme/App", number, id: 9000 + number, title: `Issue ${number}`, type: null, labels: [], state: "open", reason: null, parent: null, url: `https://github.com/Acme/App/issues/${number}`, updated_at: "2026-10-23T10:00:00Z" });
const arrive = (rows: unknown[]) => db.asService((q) => q("select public.tracker_upsert_issues($1, $2::jsonb)", [connA, JSON.stringify(rows)]), { commit: true, via: "GitHub webhook" });
const idOf = async (n: number) => (await db.admin.query("select id from public.tracker_issues where connection_id = $1 and issue_number = $2", [connA, n])).rows[0].id as string;
const pull = (as: string, ids: string[], mode?: string) =>
  db.asUser(as, (q) => (mode === undefined ? q("select * from public.tracker_pull_in($1::uuid[], $2)", [ids, projectA]) : q("select * from public.tracker_pull_in($1::uuid[], $2, $3)", [ids, projectA, mode])), { commit: true });
const setMode = (as: string, item: string, mode: string) => db.asUser(as, (q) => q("select public.item_set_link_mode($1, $2) as before", [item, mode]), { commit: true });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-owner@example.test");
  viewer = await createUser(db, "viewer-owner@example.test");
  service = await createUser(db, "service-owner@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  await db.admin.query("delete from public.tracker_issues");
  await db.admin.query("delete from public.item_github_links");
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1", [f.tenantA])).rows[0].id;
  projectA = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  itemA = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  await arrive([issue(1), issue(2), issue(3), issue(4)]);
});
afterAll(async () => {
  await db.close();
});

describe("pulling in with a choice of ownership", () => {
  it("without a choice the item follows the issue read-only, as before", async () => {
    const r = await pull(creator, [await idOf(1)]);
    expect(r.rows[0]).toMatchObject({ ok: true });
    expect(await link(r.rows[0].item_id)).toMatchObject({ mode: "follow", sync_state: "synced" });
  });

  it("PV takes ownership: the link is a push link and nothing has been recorded as sent", async () => {
    const r = await pull(creator, [await idOf(2)], "push");
    expect(r.rows[0]).toMatchObject({ ok: true });
    const l = await link(r.rows[0].item_id);
    expect(l).toMatchObject({ mode: "push", last_pushed_hash: null });
  });

  it("a choice that is neither read only nor ownership is refused", async () => {
    expect(await errorCode(pull(creator, [await idOf(3)], "admin"))).toBe("22023");
  });

  it("a viewer cannot pull in, with either choice", async () => {
    expect(await errorCode(pull(viewer, [await idOf(3)], "push"))).toBe(DENIED);
  });
});

describe("changing who owns a linked initiative", () => {
  let item: string;
  beforeAll(async () => {
    item = (await pull(creator, [await idOf(4)])).rows[0].item_id;
  });

  it("a creator takes ownership and gets the previous mode back; the change is audited with the person and the source, and can be put back", async () => {
    const r = await setMode(creator, item, "push");
    expect(r.rows[0].before).toBe("follow");
    expect((await link(item)).mode).toBe("push");
    const a = await db.admin.query("select actor_id, via, old, new from public.audit_log where entity = 'item_github_links' and field = 'mode' order by id desc limit 1");
    expect(a.rows[0]).toMatchObject({ actor_id: creator, via: "UI" });
    expect(JSON.stringify([a.rows[0].old, a.rows[0].new])).toContain("follow");
    expect((await setMode(creator, item, "follow")).rows[0].before).toBe("push"); // undo: the caller puts the previous mode back
    expect((await link(item)).mode).toBe("follow");
  });

  it("the same mode again changes nothing", async () => {
    const before = (await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'item_github_links' and field = 'mode'")).rows[0].n;
    await setMode(creator, item, "follow");
    expect((await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'item_github_links' and field = 'mode'")).rows[0].n).toBe(before);
  });

  it("a viewer, a service account and another workspace's admin cannot change it", async () => {
    expect(await errorCode(setMode(viewer, item, "push"))).toBe(DENIED);
    expect(await errorCode(setMode(service, item, "push"))).toBe(DENIED);
    expect(await errorCode(setMode(f.bob, item, "push"))).toBe(DENIED);
    expect((await link(item)).mode).toBe("follow");
  });

  it("another workspace's initiative cannot be changed by this workspace's admin", async () => {
    expect(await errorCode(setMode(f.alice, itemB, "push"))).toBe(DENIED);
  });

  it("an initiative with no issue linked says so", async () => {
    await db.admin.query("delete from public.item_github_links where item_id = $1", [itemA]);
    expect(await errorCode(setMode(f.alice, itemA, "push"))).toBe("P0002");
  });

  it("only read only or ownership are accepted", async () => {
    expect(await errorCode(setMode(creator, item, "both"))).toBe("22023");
  });
});
