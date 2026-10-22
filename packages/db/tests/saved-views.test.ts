import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, leader: string;

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-views@example.test");
  viewer = await createUser(db, "viewer-views@example.test");
  leader = await createUser(db, "leader-views@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, leader, "leadership");
});
afterAll(async () => {
  await db.close();
});

const add = (user: string, name: string, extra = "", tenant = f.tenantA) =>
  db.asUser(
    user,
    async (q) => (await q(`insert into public.saved_views (tenant_id, name, columns${extra ? ", " + extra.split("|")[0] : ""}) values ($1, $2, array['stack_rank','item_code','initiative_name','moscow']${extra ? ", " + extra.split("|")[1] : ""}) returning id`, [tenant, name])).rows[0].id as string,
    { commit: true, via: "UI" },
  );

describe("saved views: who can do what", () => {
  it("everyone in the workspace reads them; creators and admins write them", async () => {
    for (const u of [f.alice, creator, viewer, leader]) {
      const n = await db.asUser(u, async (q) => (await q("select 1 from public.saved_views where tenant_id = $1", [f.tenantA])).rowCount);
      expect(n, u).toBeGreaterThan(0);
    }
    expect(await add(creator, "Creator view")).toBeTruthy();
    expect(await add(f.alice, "Admin view")).toBeTruthy();
  });
  it("viewers and leadership cannot write; nobody sees another tenant's views", async () => {
    for (const u of [viewer, leader]) expect(await errorCode(add(u, `Nope ${u}`))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.saved_views where tenant_id = $1", [f.tenantA])).rowCount)).toBe(0);
    expect(await errorCode(add(f.alice, "Cross", "", f.tenantB))).toBe(DENIED);
  });
  it("creators and admins can change and delete a view; viewers cannot", async () => {
    const id = await add(creator, "To change");
    expect(await db.asUser(viewer, async (q) => (await q("update public.saved_views set name = 'x' where id = $1", [id])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.alice, async (q) => (await q("update public.saved_views set name = 'Renamed', group_by = 'moscow', filters = '[{\"field\":\"moscow\",\"op\":\"is\",\"value\":\"Must\"}]'::jsonb, columns = array['item_code'] where id = $1", [id])).rowCount, { commit: true, via: "UI" })).toBe(1);
    expect(await db.asUser(viewer, async (q) => (await q("delete from public.saved_views where id = $1", [id])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(creator, async (q) => (await q("delete from public.saved_views where id = $1", [id])).rowCount, { commit: true })).toBe(1);
  });
});

describe("saved views: constraints", () => {
  it("needs a name of 1 to 80 characters, unique in the workspace ignoring case and spaces", async () => {
    expect(await errorCode(add(creator, "   "))).toBe(CHECK);
    expect(await errorCode(add(creator, "x".repeat(81)))).toBe(CHECK);
    await add(creator, "Planning board");
    expect(await errorCode(add(creator, "  planning BOARD "))).toBe(UNIQUE);
    expect(await add(f.bob, "Planning board", "", f.tenantB)).toBeTruthy(); // another workspace may use the name
  });
  it("needs 1 to 200 columns, none empty", async () => {
    for (const cols of ["array[]::text[]", "array['a','']", "array['a',null]", `(select array_agg('c' || g) from generate_series(1, 201) g)`]) {
      expect(await errorCode(db.asUser(creator, (q) => q(`insert into public.saved_views (tenant_id, name, columns) values ($1, 'Bad ' || $2::text, ${cols})`, [f.tenantA, cols.length]))), cols).toBe(CHECK);
    }
  });
  it("filters must be a list of at most 20; the group is optional", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.saved_views (tenant_id, name, columns, filters) values ($1, 'F1', array['a'], '{}'::jsonb)", [f.tenantA])))).toBe(CHECK);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.saved_views (tenant_id, name, columns, filters) values ($1, 'F2', array['a'], (select jsonb_agg(g) from generate_series(1, 21) g))", [f.tenantA])))).toBe(CHECK);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.saved_views (tenant_id, name, columns, group_by) values ($1, 'F3', array['a'], '')", [f.tenantA])))).toBe(CHECK);
    expect(await add(creator, "Grouped", "group_by|'health'")).toBeTruthy();
  });
  it("tenant, creator and source cannot be set or changed through the API", async () => {
    const id = await add(creator, "Locked columns");
    expect(await errorCode(db.asUser(creator, (q) => q("update public.saved_views set tenant_id = $1 where id = $2", [f.tenantB, id])))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.saved_views set created_by = null where id = $1", [id])))).toBe(DENIED);
  });
});

describe("saved views: audit", () => {
  it("records create, each changed field, and delete with actor and source", async () => {
    const id = await add(creator, "Audited view");
    await db.asUser(creator, (q) => q("update public.saved_views set name = 'Audited view 2', group_by = 'moscow' where id = $1", [id]), { commit: true, via: "UI" });
    await db.asUser(creator, (q) => q("delete from public.saved_views where id = $1", [id]), { commit: true, via: "UI" });
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'saved_views' and entity_id = $1 order by at, field", [id]);
    expect(rows.find((r) => r.field === "name" && r.new === "Audited view")).toMatchObject({ old: null, via: "UI", actor_id: creator });
    expect(rows.find((r) => r.field === "name" && r.new === "Audited view 2")).toMatchObject({ old: "Audited view" });
    expect(rows.find((r) => r.field === "group_by")).toMatchObject({ old: null, new: "moscow" });
    expect(rows.find((r) => r.field === "name" && r.new === null)).toMatchObject({ old: "Audited view 2" }); // delete
  });
});

describe("saved scopes (portfolio scope)", () => {
  it("a creator can create a scope with projects, rename it and delete it; the links go with it; writes are audited", async () => {
    const proj = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'Scope test project') returning id", [f.tenantA])).rows[0].id;
    const scope = await db.asUser(creator, async (q) => {
      const s = (await q("insert into public.saved_scopes (tenant_id, name) values ($1, 'Customer-facing') returning id", [f.tenantA])).rows[0].id;
      await q("insert into public.saved_scope_projects (tenant_id, scope_id, project_id) values ($1, $2, $3), ($1, $2, $4)", [f.tenantA, s, proj, f.seedA.project]);
      return s as string;
    }, { commit: true, via: "UI" });
    expect((await db.admin.query("select count(*)::int as n from public.saved_scope_projects where scope_id = $1", [scope])).rows[0].n).toBe(2);
    await db.asUser(creator, (q) => q("update public.saved_scopes set name = 'Customer-facing work' where id = $1", [scope]), { commit: true, via: "UI" });
    expect((await db.admin.query("select new from public.audit_log where entity = 'saved_scopes' and entity_id = $1 and field = 'name' order by at desc limit 1", [scope])).rows[0].new).toBe("Customer-facing work");
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.saved_scope_projects (tenant_id, scope_id, project_id) values ($1, $2, $3)", [f.tenantA, scope, f.seedB.project])))).toBe("23503"); // another tenant's project
    expect(await db.asUser(creator, async (q) => (await q("delete from public.saved_scopes where id = $1", [scope])).rowCount, { commit: true })).toBe(1);
    expect((await db.admin.query("select count(*)::int as n from public.saved_scope_projects where scope_id = $1", [scope])).rows[0].n).toBe(0);
  });
  it("viewers cannot create scopes", async () => {
    expect(await errorCode(db.asUser(viewer, (q) => q("insert into public.saved_scopes (tenant_id, name) values ($1, 'Nope')", [f.tenantA])))).toBe(DENIED);
  });
});
