import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, leader: string, commenter: string;

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";
const MONDAY = "2026-10-19";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-weekly@example.test");
  viewer = await createUser(db, "viewer-weekly@example.test");
  leader = await createUser(db, "leader-weekly@example.test");
  commenter = await createUser(db, "commenter-weekly@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, leader, "leadership");
  await addMember(db, f.alice, f.tenantA, commenter, "commenter");
});
afterAll(async () => {
  await db.close();
});

let n = 0;
const add = (user: string, o: { week?: string; scope?: string; body?: string; tenant?: string; via?: string } = {}) =>
  db.asUser(user, async (q) => (await q("insert into public.weekly_updates (tenant_id, week_start, scope_key, body) values ($1, $2, $3, $4) returning id", [o.tenant ?? f.tenantA, o.week ?? MONDAY, o.scope ?? `s${++n}`, o.body ?? "Draft"])).rows[0].id as string, { commit: true, via: o.via ?? "UI" });
const row = async (id: string) => (await db.admin.query("select * from public.weekly_updates where id = $1", [id])).rows[0];

describe("weekly updates: who can do what", () => {
  it("everyone in the workspace reads them; only creators and admins write", async () => {
    const id = await add(creator);
    for (const u of [creator, viewer, leader, commenter, f.alice]) {
      expect(await db.asUser(u, async (q) => (await q("select 1 from public.weekly_updates where id = $1", [id])).rowCount), u).toBe(1);
    }
    expect(await add(f.alice)).toBeTruthy();
    for (const u of [viewer, leader, commenter]) expect(await errorCode(add(u)), u).toBe(DENIED);
  });
  it("a leadership viewer cannot change or review a draft, and nobody can delete one", async () => {
    const id = await add(creator);
    for (const u of [leader, viewer]) {
      expect(await db.asUser(u, async (q) => (await q("update public.weekly_updates set body = 'x' where id = $1", [id])).rowCount, { commit: true }), u).toBe(0);
      expect(await db.asUser(u, async (q) => (await q("update public.weekly_updates set reviewed_at = now() where id = $1", [id])).rowCount, { commit: true }), u).toBe(0);
    }
    expect(await errorCode(db.asUser(creator, (q) => q("delete from public.weekly_updates where id = $1", [id])))).toBe(DENIED);
    expect((await row(id)).body).toBe("Draft");
  });
  it("another workspace cannot read or write them", async () => {
    const id = await add(creator);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.weekly_updates where id = $1", [id])).rowCount)).toBe(0);
    expect(await errorCode(add(f.alice, { tenant: f.tenantB }))).toBe(DENIED);
  });
});

describe("weekly updates: constraints", () => {
  it("the week starts on a Monday, the body is 1 to 20,000 characters, one draft per week and scope", async () => {
    expect(await errorCode(add(creator, { week: "2026-10-21" }))).toBe(CHECK);
    expect(await errorCode(add(creator, { body: "" }))).toBe(CHECK);
    expect(await errorCode(add(creator, { body: "x".repeat(20001) }))).toBe(CHECK);
    await add(creator, { scope: "same" });
    expect(await errorCode(add(f.alice, { scope: "same" }))).toBe(UNIQUE);
    expect(await add(creator, { scope: "same", week: "2026-10-26" })).toBeTruthy(); // another week
    expect(await add(f.bob, { scope: "same", tenant: f.tenantB })).toBeTruthy(); // another workspace
  });
  it("a draft is never created as reviewed, and tenant and creator cannot be changed", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.weekly_updates (tenant_id, week_start, scope_key, body, reviewed_at) values ($1, $2, 'r', 'x', now())", [f.tenantA, MONDAY])))).toBe(DENIED);
    const id = await add(creator);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.weekly_updates set tenant_id = $1 where id = $2", [f.tenantB, id])))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.weekly_updates set reviewed_by = $1 where id = $2", [creator, id])))).toBe(DENIED);
  });
});

describe("weekly updates: reviewing", () => {
  it("marking reviewed records who and when (the database sets both), and editing the text clears it", async () => {
    const id = await add(creator, { body: "Draft v1" });
    await db.asUser(f.alice, (q) => q("update public.weekly_updates set reviewed_at = '2001-01-01' where id = $1", [id]), { commit: true, via: "UI" });
    const r = await row(id);
    expect(r.reviewed_by).toBe(f.alice);
    expect(new Date(r.reviewed_at).getFullYear()).toBeGreaterThan(2020); // the time sent by the browser is ignored
    await db.asUser(creator, (q) => q("update public.weekly_updates set body = 'Draft v2' where id = $1", [id]), { commit: true, via: "UI" });
    const after = await row(id);
    expect(after).toMatchObject({ body: "Draft v2", reviewed_at: null, reviewed_by: null });
  });
  it("changing the text and the reviewed time together leaves it unreviewed; un-reviewing clears who", async () => {
    const id = await add(creator);
    await db.asUser(creator, (q) => q("update public.weekly_updates set body = 'Both', reviewed_at = now() where id = $1", [id]), { commit: true, via: "UI" });
    expect((await row(id)).reviewed_at).toBeNull();
    await db.asUser(creator, (q) => q("update public.weekly_updates set reviewed_at = now() where id = $1", [id]), { commit: true, via: "UI" });
    expect((await row(id)).reviewed_by).toBe(creator);
    await db.asUser(creator, (q) => q("update public.weekly_updates set reviewed_at = null where id = $1", [id]), { commit: true, via: "UI" });
    expect(await row(id)).toMatchObject({ reviewed_at: null, reviewed_by: null });
  });
  it("Claude cannot mark an update as reviewed, but can write the draft", async () => {
    const id = await add(creator, { via: "Claude MCP" });
    expect(await errorCode(db.asUser(creator, (q) => q("update public.weekly_updates set reviewed_at = now() where id = $1", [id]), { via: "Claude MCP" }))).toBe("PV004");
    await db.asUser(creator, (q) => q("update public.weekly_updates set body = 'Claude draft' where id = $1", [id]), { commit: true, via: "Claude MCP" });
    expect((await row(id)).body).toBe("Claude draft");
  });
});

describe("weekly updates: audit", () => {
  it("records the draft, each edit and the review with actor and source", async () => {
    const id = await add(creator, { body: "Audited" });
    await db.asUser(creator, (q) => q("update public.weekly_updates set body = 'Audited 2' where id = $1", [id]), { commit: true, via: "UI" });
    await db.asUser(f.alice, (q) => q("update public.weekly_updates set reviewed_at = now() where id = $1", [id]), { commit: true, via: "UI" });
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'weekly_updates' and entity_id = $1 order by at, id", [id]);
    expect(rows.find((r) => r.field === "body" && r.new === "Audited")).toMatchObject({ old: null, via: "UI", actor_id: creator });
    expect(rows.find((r) => r.field === "body" && r.new === "Audited 2")).toMatchObject({ old: "Audited" });
    expect(rows.find((r) => r.field === "reviewed_by" && r.new === f.alice)).toMatchObject({ actor_id: f.alice });
  });
});

describe("weekly_item_changes: what moved, readable by every member", () => {
  const changes = (user: string, tenant = f.tenantA, since = "2000-01-01") =>
    db.asUser(user, async (q) => (await q("select * from public.weekly_item_changes($1, $2)", [tenant, since])).rows as { item_id: string; field: string; old: unknown; new: unknown; actor_id: string | null; via: string }[]);
  it("returns rank, status and health changes since a time, and nothing else", async () => {
    const id = (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Moves', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;
    await db.asUser(creator, (q) => q("update public.items set health = 'At Risk', effort = 'M', moscow = 'Must' where id = $1", [id]), { commit: true, via: "UI" });
    const rows = (await changes(leader)).filter((r) => r.item_id === id);
    expect(rows.map((r) => r.field)).toContain("health");
    expect(rows.map((r) => r.field)).not.toContain("effort"); // effort and MoSCoW are not part of the weekly picture
    expect(rows.map((r) => r.field)).not.toContain("moscow");
    expect(rows.find((r) => r.field === "health")).toMatchObject({ new: "At Risk", actor_id: creator, via: "UI" });
    expect((await changes(viewer)).some((r) => r.item_id === id)).toBe(true);
  });
  it("includes rank moves and respects the time", async () => {
    const id = (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Ranks', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;
    await db.asUser(creator, (q) => q("select public.move_item($1, 1)", [id]), { commit: true, via: "UI" });
    expect((await changes(creator)).some((r) => r.item_id === id && r.field === "stack_rank")).toBe(true);
    expect((await changes(creator, f.tenantA, "2999-01-01"))).toEqual([]);
  });
  it("refuses a workspace you are not a member of, and anonymous visitors", async () => {
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.weekly_item_changes($1, '2000-01-01')", [f.tenantA])))).toBe(DENIED);
    expect(await errorCode(db.asAnon((q) => q("select * from public.weekly_item_changes($1, '2000-01-01')", [f.tenantA])))).toBe(DENIED);
    expect((await changes(f.bob, f.tenantB)).every((r) => r.item_id !== undefined)).toBe(true);
  });
});
