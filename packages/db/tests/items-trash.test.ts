import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, other: string, viewer: string, leader: string, commenter: string, bot: string;

const DENIED = "42501";
const BLOCKED = "PV004";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "trash-creator@example.test");
  other = await createUser(db, "trash-other@example.test");
  viewer = await createUser(db, "trash-viewer@example.test");
  leader = await createUser(db, "trash-leader@example.test");
  commenter = await createUser(db, "trash-commenter@example.test");
  bot = await createUser(db, "trash-bot@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, other, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, leader, "leadership");
  await addMember(db, f.alice, f.tenantA, commenter, "commenter");
  await addMember(db, f.alice, f.tenantA, bot, "creator", { serviceAccount: true });
});
afterAll(async () => { await db.close(); });

const add = async (user: string, title: string, tenant = f.tenantA, project = f.seedA.project) =>
  (await db.asUser(user, async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3) returning id, item_code, stack_rank", [tenant, title, project])).rows[0], { commit: true, via: "UI" })) as { id: string; item_code: string; stack_rank: number };
type Outcome = { id: string; ok: boolean; reason: string | null; stack_rank?: number };
const call = (user: string, fn: string, ids: string[], via = "UI") =>
  db.asUser(user, async (q) => (await q(`select * from public.${fn}($1)`, [ids])).rows as Outcome[], { commit: true, via });
const live = async (tenant = f.tenantA) =>
  (await db.admin.query("select id, initiative_name as name, stack_rank from public.items where tenant_id = $1 and cycle_id is null and deleted_at is null order by stack_rank", [tenant])).rows as { id: string; name: string; stack_rank: number }[];
const row = async (id: string) => (await db.admin.query("select * from public.items where id = $1", [id])).rows[0];
const dense = (rows: { stack_rank: number }[]) => rows.map((r) => r.stack_rank);

describe("delete_items (soft delete)", () => {
  it("hides the item from every reader, keeps the row, and closes the rank gap", async () => {
    const a = await add(creator, "Trash A");
    const b = await add(creator, "Trash B");
    const c = await add(creator, "Trash C");
    const before = await live();
    const r = await call(creator, "delete_items", [b.id]);
    expect(r).toEqual([{ id: b.id, ok: true, reason: null }]);
    const after = await live();
    expect(after.map((x) => x.id)).not.toContain(b.id);
    expect(dense(after)).toEqual(after.map((_, i) => i + 1));
    expect(after).toHaveLength(before.length - 1);
    // the row is kept, with who and when
    const kept = await row(b.id);
    expect(kept.deleted_by).toBe(creator);
    expect(kept.deleted_at).toBeTruthy();
    // nobody sees it through the table or the computed view, not even the person who deleted it or an admin
    for (const u of [creator, f.alice, viewer, leader, commenter]) {
      expect(await db.asUser(u, async (q) => (await q("select id from public.items where id = $1", [b.id])).rowCount)).toBe(0);
      expect(await db.asUser(u, async (q) => (await q("select id from public.items_computed where id = $1", [b.id])).rowCount)).toBe(0);
    }
    expect(a.id).toBeTruthy(); expect(c.id).toBeTruthy();
  });

  it("is one audited change per item with the right actor and source", async () => {
    const x = await add(creator, "Audit me");
    const mark = (await db.admin.query("select coalesce(max(id), 0) m from public.audit_log")).rows[0].m;
    await call(creator, "delete_items", [x.id], "UI");
    const rows = (await db.admin.query("select field, old, new, actor_id, via from public.audit_log where id > $1 and entity = 'items' and entity_id = $2 and field in ('deleted_at', 'deleted_by')", [mark, x.id])).rows;
    expect(rows.map((r) => r.field).sort()).toEqual(["deleted_at", "deleted_by"]);
    expect(rows.every((r) => r.actor_id === creator && r.via === "UI")).toBe(true);
    expect(rows.find((r) => r.field === "deleted_by")).toMatchObject({ old: null, new: creator });
  });

  it("creators delete their own items; an admin deletes any; others cannot", async () => {
    const mine = await add(creator, "Mine");
    const theirs = await add(other, "Theirs");
    expect(await call(creator, "delete_items", [mine.id, theirs.id])).toEqual(expect.arrayContaining([
      { id: mine.id, ok: true, reason: null },
      { id: theirs.id, ok: false, reason: "Only the person who added it or an admin can delete it." },
    ]));
    expect((await row(theirs.id)).deleted_at).toBeNull();
    expect(await call(f.alice, "delete_items", [theirs.id])).toEqual([{ id: theirs.id, ok: true, reason: null }]);
    for (const u of [viewer, leader, commenter]) {
      const x = await add(creator, "Not for them");
      expect((await call(u, "delete_items", [x.id]))[0]).toMatchObject({ ok: false, reason: "Your role cannot delete initiatives." });
    }
  });

  it("lists the rows with problems and still deletes the rest", async () => {
    const good = await add(creator, "Good");
    const gone = await add(creator, "Already gone");
    await call(creator, "delete_items", [gone.id]);
    const unknown = "00000000-0000-0000-0000-000000000099";
    const r = await call(creator, "delete_items", [good.id, gone.id, unknown]);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by[good.id]!.ok).toBe(true);
    expect(by[gone.id]).toMatchObject({ ok: false, reason: "It is already in the Trash." });
    expect(by[unknown]).toMatchObject({ ok: false });
  });

  it("refuses Claude and service accounts (a person confirms)", async () => {
    const x = await add(creator, "Claude cannot delete");
    expect(await errorCode(call(creator, "delete_items", [x.id], "Claude MCP"))).toBe(BLOCKED);
    expect(await errorCode(call(bot, "delete_items", [x.id], "API"))).toBe(BLOCKED);
    expect(await errorCode(call(f.alice, "restore_items", [x.id], "Claude MCP"))).toBe(BLOCKED);
    expect(await errorCode(call(f.alice, "purge_items", [x.id], "Claude MCP"))).toBe(BLOCKED);
    expect((await row(x.id)).deleted_at).toBeNull();
  });

  it("cannot reach another workspace's items", async () => {
    const b = await add(f.bob, "Tenant B item", f.tenantB, f.seedB.project);
    expect((await call(f.alice, "delete_items", [b.id]))[0]).toMatchObject({ ok: false });
    expect((await call(f.bob, "delete_items", [b.id]))[0]).toMatchObject({ ok: true });
    expect((await call(f.alice, "restore_items", [b.id]))[0]).toMatchObject({ ok: false });
    expect((await call(f.alice, "purge_items", [b.id]))[0]).toMatchObject({ ok: false });
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.trashed_items($1)", [f.tenantB])))).toBe(DENIED);
    await call(f.bob, "restore_items", [b.id]);
  });

  it("nobody can delete rows or write the delete columns directly", async () => {
    const x = await add(creator, "Direct");
    for (const u of [creator, f.alice]) {
      expect(await errorCode(db.asUser(u, (q) => q("delete from public.items where id = $1", [x.id])))).toBe(DENIED);
      expect(await errorCode(db.asUser(u, (q) => q("update public.items set deleted_at = now() where id = $1", [x.id])))).toBe(DENIED);
    }
  });

  it("deleted items cannot be edited or re-ranked", async () => {
    const x = await add(creator, "Frozen");
    await call(creator, "delete_items", [x.id]);
    expect(await db.asUser(creator, async (q) => (await q("update public.items set initiative_name = 'changed' where id = $1", [x.id])).rowCount, { commit: true })).toBe(0);
    expect(await errorCode(db.asUser(creator, (q) => q("select public.move_item($1, 1)", [x.id]), { commit: true }))).toBe(DENIED);
  });
});

describe("new items and ranks with deleted items around", () => {
  it("a new item takes the next live rank (deleted ranks are not counted) and codes are never reused", async () => {
    const x = await add(creator, "Code check");
    const code = x.item_code;
    await call(creator, "delete_items", [x.id]);
    const n = await add(creator, "After delete");
    expect(n.item_code).not.toBe(code);
    const rows = await live();
    expect(n.stack_rank).toBe(rows.length);
    expect(dense(rows)).toEqual(rows.map((_, i) => i + 1));
  });

  it("moving an item still works and ignores deleted ones", async () => {
    const a = await add(creator, "Move me");
    const gone = await add(creator, "Gone");
    await call(creator, "delete_items", [gone.id]);
    await db.asUser(creator, (q) => q("select public.move_item($1, 1)", [a.id]), { commit: true, via: "UI" });
    const rows = await live();
    expect(rows[0]!.id).toBe(a.id);
    expect(dense(rows)).toEqual(rows.map((_, i) => i + 1));
  });
});

describe("trashed_items and restore_items", () => {
  it("creators and admins see the Trash with who and when; viewers, commenters and leadership do not", async () => {
    const x = await add(creator, "In the trash");
    await call(creator, "delete_items", [x.id]);
    for (const u of [creator, f.alice]) {
      const rows = await db.asUser(u, async (q) => (await q("select * from public.trashed_items($1)", [f.tenantA])).rows);
      const mine = rows.find((r) => r.id === x.id);
      expect(mine).toMatchObject({ initiative_name: "In the trash", deleted_by: creator, item_code: x.item_code });
      expect(mine.deleted_at).toBeTruthy();
      expect(Object.keys(mine)).not.toContain("value_12m");
      expect(Object.keys(mine)).not.toContain("decision");
    }
    for (const u of [viewer, leader, commenter]) expect(await errorCode(db.asUser(u, (q) => q("select * from public.trashed_items($1)", [f.tenantA])))).toBe(DENIED);
  });

  it("restore puts items back at their old ranks and the others shift down; one audited change per item", async () => {
    const items = [];
    for (const n of ["R1", "R2", "R3", "R4", "R5", "R6"]) items.push(await add(creator, n));
    const original = (await live()).map((r) => r.id);
    const [, r2, , r4] = items;
    await call(creator, "delete_items", [r2!.id, r4!.id]);
    expect((await live()).map((r) => r.id)).toEqual(original.filter((id) => id !== r2!.id && id !== r4!.id));
    const mark = (await db.admin.query("select coalesce(max(id), 0) m from public.audit_log")).rows[0].m;
    const res = await call(creator, "restore_items", [r4!.id, r2!.id], "UI");
    expect(res.every((x) => x.ok)).toBe(true);
    const after = await live();
    expect(after.map((r) => r.id)).toEqual(original); // exactly where they were
    expect(dense(after)).toEqual(after.map((_, i) => i + 1));
    expect((await row(r2!.id)).deleted_at).toBeNull();
    const audit = (await db.admin.query("select actor_id, via from public.audit_log where id > $1 and entity = 'items' and entity_id = $2 and field = 'deleted_at'", [mark, r2!.id])).rows;
    expect(audit).toEqual([{ actor_id: creator, via: "UI" }]);
    expect(res.find((x) => x.id === r2!.id)!.stack_rank).toBe(original.indexOf(r2!.id) + 1);
  });

  it("puts an item at the end when its old rank no longer exists", async () => {
    const x = await add(creator, "Was last");
    await call(creator, "delete_items", [x.id]);
    // everything after it in the list is also deleted, so the old rank is beyond the end
    const tail = await add(creator, "Tail 1");
    const tail2 = await add(creator, "Tail 2");
    await call(creator, "delete_items", [tail.id, tail2.id]);
    const before = (await live()).length;
    const rows = await call(creator, "restore_items", [x.id]);
    expect(rows[0]).toMatchObject({ ok: true });
    expect(rows[0]!.stack_rank).toBeLessThanOrEqual(before + 1);
    const after = await live();
    expect(dense(after)).toEqual(after.map((_, i) => i + 1));
  });

  it("who may restore: admins any; creators what they added or deleted; others nothing", async () => {
    const x = await add(creator, "Restore rules");
    await call(f.alice, "delete_items", [x.id]);
    expect((await call(other, "restore_items", [x.id]))[0]).toMatchObject({ ok: false });
    expect((await call(viewer, "restore_items", [x.id]))[0]).toMatchObject({ ok: false });
    expect((await call(creator, "restore_items", [x.id]))[0]).toMatchObject({ ok: true }); // they added it
    const y = await add(creator, "Deleted by other creator");
    await call(f.alice, "delete_items", [y.id]);
    expect((await call(f.alice, "restore_items", [y.id]))[0]).toMatchObject({ ok: true });
    expect((await call(creator, "restore_items", [y.id]))[0]).toMatchObject({ ok: false, reason: "It is not in the Trash." });
  });
});

describe("purge_items (Delete forever)", () => {
  it("is admin-only and only from the Trash; the audit entry keeps item code and name only", async () => {
    const x = await add(creator, "Forget me");
    await db.admin.query("update public.items set summary = 'a private note', value_12m = 1234, decision = 'Kill' where id = $1", [x.id]);
    await db.admin.query("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'sensitive-tag')", [f.tenantA, x.id]);
    expect((await call(f.alice, "purge_items", [x.id]))[0]).toMatchObject({ ok: false, reason: "Only items in the Trash can be deleted forever." });
    await call(creator, "delete_items", [x.id]);
    for (const u of [creator, viewer, leader]) expect((await call(u, "purge_items", [x.id]))[0]).toMatchObject({ ok: false, reason: "Only an admin can delete items forever." });
    const mark = (await db.admin.query("select coalesce(max(id), 0) m from public.audit_log")).rows[0].m;
    expect((await call(f.alice, "purge_items", [x.id], "UI"))[0]).toMatchObject({ ok: true });
    expect(await row(x.id)).toBeUndefined();
    expect((await db.admin.query("select count(*)::int n from public.item_tags where item_id = $1", [x.id])).rows[0].n).toBe(0);
    const audit = (await db.admin.query("select entity, field, old, new, actor_id, via from public.audit_log where id > $1 order by id", [mark])).rows;
    const mine = audit.filter((a) => a.entity === "items");
    expect(mine.map((a) => a.field).sort()).toEqual(["initiative_name", "item_code"]);
    expect(mine.find((a) => a.field === "initiative_name")).toMatchObject({ old: "Forget me", new: null, actor_id: f.alice, via: "UI" });
    expect(JSON.stringify(audit)).not.toMatch(/private note|1234|sensitive-tag/);
  });

  it("closes no gap among live items and the code is never reused afterwards", async () => {
    const x = await add(creator, "Purge code");
    await call(creator, "delete_items", [x.id]);
    await call(f.alice, "purge_items", [x.id]);
    const n = await add(creator, "Next");
    expect(n.item_code).not.toBe(x.item_code);
    const rows = await live();
    expect(dense(rows)).toEqual(rows.map((_, i) => i + 1));
  });

  it("purge_old_trash removes only items deleted more than 30 days ago, and only the service role may run it", async () => {
    const old = await add(creator, "Old trash");
    const recent = await add(creator, "Recent trash");
    await call(creator, "delete_items", [old.id, recent.id]);
    await db.admin.query("update public.items set deleted_at = now() - interval '31 days' where id = $1", [old.id]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.purge_old_trash(30)")))).toBe(DENIED);
    const n = await db.asService(async (q) => (await q("select public.purge_old_trash(30) as n")).rows[0].n as number, { commit: true, via: "system" });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await row(old.id)).toBeUndefined();
    expect((await row(recent.id)).deleted_at).toBeTruthy();
  });
});

describe("discard_new_items (undo of a quick-add)", () => {
  it("only the person who just added it can take it back completely; nothing goes to the Trash", async () => {
    const x = await add(creator, "Oops");
    expect((await call(other, "discard_new_items", [x.id]))[0]).toMatchObject({ ok: false });
    expect((await call(viewer, "discard_new_items", [x.id]))[0]).toMatchObject({ ok: false });
    expect((await call(creator, "discard_new_items", [x.id]))[0]).toMatchObject({ ok: true });
    expect(await row(x.id)).toBeUndefined();
    const y = await add(creator, "Too late");
    await db.admin.query("update public.items set created_at = now() - interval '20 minutes' where id = $1", [y.id]);
    expect((await call(creator, "discard_new_items", [y.id]))[0]).toMatchObject({ ok: false });
    const rows = await live();
    expect(dense(rows)).toEqual(rows.map((_, i) => i + 1));
  });
});

describe("deleted items never show up elsewhere", () => {
  it("not in the weekly changes, the activity of the item, or the group usage counts", async () => {
    const x = await add(creator, "Hidden everywhere");
    await db.asUser(creator, (q) => q("update public.items set health = 'At Risk', theme = 'Trash theme' where id = $1", [x.id]), { commit: true, via: "UI" });
    const since = new Date(Date.now() - 3600_000).toISOString();
    const has = async () => (await db.asUser(creator, async (q) => (await q("select item_id from public.weekly_item_changes($1, $2)", [f.tenantA, since])).rows)).some((r) => r.item_id === x.id);
    const count = async () => (await db.asUser(creator, async (q) => (await q("select items from public.item_group_usage($1) where name = 'Trash theme'", [f.tenantA])).rows[0]?.items)) as string | undefined;
    expect(await has()).toBe(true);
    expect(Number(await count())).toBe(1);
    await call(creator, "delete_items", [x.id]);
    expect(await has()).toBe(false);
    expect(Number(await count())).toBe(0);
    expect(await errorCode(db.asUser(creator, (q) => q("select * from public.item_activity($1)", [x.id])))).toBe(DENIED);
    await call(creator, "restore_items", [x.id]);
    expect(await has()).toBe(true);
    expect((await db.asUser(creator, async (q) => (await q("select count(*)::int n from public.item_activity($1)", [x.id])).rows[0].n)) > 0).toBe(true);
  });
});

describe("speed", () => {
  it("deleting 100 items on a workspace with 2,000 items takes well under a second, in one call", async () => {
    const tenant = (await db.asUser(await createUser(db, "big-owner@example.test"), async (q) => (await q("select public.create_tenant('Big') as id")).rows[0].id as string, { commit: true }));
    const project = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'Big') returning id", [tenant])).rows[0].id;
    await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) select $1, 'Item ' || g, $2 from generate_series(1, 2000) g", [tenant, project]);
    const admin = (await db.admin.query("select user_id from public.tenant_members where tenant_id = $1 and role = 'admin'", [tenant])).rows[0].user_id as string;
    const ids = (await db.admin.query("select id from public.items where tenant_id = $1 and stack_rank % 20 = 5 order by stack_rank limit 100", [tenant])).rows.map((r) => r.id as string);
    expect(ids).toHaveLength(100);
    const t0 = performance.now();
    const res = await db.asUser(admin, async (q) => (await q("select * from public.delete_items($1)", [ids])).rows as Outcome[], { commit: true, via: "UI" });
    const ms = performance.now() - t0;
    expect(res.every((r) => r.ok)).toBe(true);
    expect(ms).toBeLessThan(1000);
    const rows = await live(tenant);
    expect(rows).toHaveLength(1900);
    expect(dense(rows)).toEqual(rows.map((_, i) => i + 1));
    const t1 = performance.now();
    await db.asUser(admin, (q) => q("select * from public.restore_items($1)", [ids]), { commit: true, via: "UI" });
    expect(performance.now() - t1).toBeLessThan(1500);
    expect(await live(tenant)).toHaveLength(2000);
  });
});
