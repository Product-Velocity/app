import { readFileSync } from "node:fs";
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

describe("default view overrides and customer-safe views (0012)", () => {
  const ins = (user: string, name: string, cols: string, extra: string, tenant = f.tenantA) =>
    db.asUser(user, (q) => q(`insert into public.saved_views (tenant_id, name, columns, ${extra.split("|")[0]}) values ($1, $2, ${cols}, ${extra.split("|")[1]})`, [tenant, name]), { commit: true, via: "UI" });

  it("the database list of customer-safe fields is the sheet's flag", async () => {
    const sheet = readFileSync(new URL("../../../docs/reference/grid-views.csv", import.meta.url), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
    const expected = sheet.filter((r) => r[3] === "Y").map((r) => r[0]);
    const { rows } = await db.admin.query("select unnest(public.customer_safe_field_keys()) as k");
    expect(rows.map((r) => r.k).sort()).toEqual([...expected].sort());
  });
  it("a customer-safe view can only hold customer-safe fields", async () => {
    await ins(creator, "Safe view", "array['item_code','initiative_name','roadmap_category']", "customer_safe|true");
    for (const bad of ["array['item_code','value_12m']", "array['item_code','confidence']", "array['value_proposition','customers_requesting']", "array['stack_rank']"]) {
      expect(await errorCode(ins(creator, `Unsafe ${bad}`, bad, "customer_safe|true")), bad).toBe(CHECK);
    }
    await ins(creator, "Ordinary with value", "array['item_code','value_12m']", "customer_safe|false"); // an internal view may
  });
  it("turning customer-safe on for a view with commercial columns is refused", async () => {
    const id = await add(creator, "Has value", "");
    await db.asUser(creator, (q) => q("update public.saved_views set columns = array['item_code','value_12m'] where id = $1", [id]), { commit: true });
    expect(await errorCode(db.asUser(creator, (q) => q("update public.saved_views set customer_safe = true where id = $1", [id])))).toBe(CHECK);
  });
  it("a default view can be customised once per workspace and only with a known name; deleting restores the default", async () => {
    await ins(creator, "Planning", "array['item_code','start_date']", "base_view|'Planning'");
    expect(await errorCode(ins(f.alice, "Planning again", "array['item_code']", "base_view|'Planning'"))).toBe(UNIQUE);
    expect(await errorCode(ins(creator, "Made up", "array['item_code']", "base_view|'Made up'"))).toBe(CHECK);
    expect(await ins(f.bob, "Planning", "array['item_code']", "base_view|'Planning'", f.tenantB)).toBeTruthy(); // another workspace
    expect(await db.asUser(creator, async (q) => (await q("delete from public.saved_views where tenant_id = $1 and base_view = 'Planning'", [f.tenantA])).rowCount, { commit: true, via: "UI" })).toBe(1);
    await ins(creator, "Planning", "array['item_code']", "base_view|'Planning'"); // can be customised again after a restore
  });
  it("the two views added by R-021 (Timeline, Cycle review) can be customised too; the check lists exactly ten names", async () => {
    await ins(creator, "Timeline", "array['item_code']", "base_view|'Timeline'");
    await ins(creator, "Cycle review", "array['item_code']", "base_view|'Cycle review'");
    expect(await errorCode(ins(creator, "Timeline again", "array['item_code']", "base_view|'Timeline'"))).toBe(UNIQUE);
    const names = (await db.admin.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'saved_views_base_view_check'")).rows[0].d as string;
    expect((names.match(/'[^']+'::text/g) ?? []).length).toBe(10);
  });
  it("a customised default is never customer-safe, and base_view cannot be changed afterwards", async () => {
    expect(await errorCode(ins(creator, "Leadership", "array['item_code']", "base_view, customer_safe|'Leadership', true"))).toBe(CHECK);
    const id = (await db.admin.query("select id from public.saved_views where tenant_id = $1 and base_view = 'Planning'", [f.tenantA])).rows[0].id;
    expect(await errorCode(db.asUser(creator, (q) => q("update public.saved_views set base_view = 'Delivery' where id = $1", [id])))).toBe(DENIED);
  });
  it("viewers and leadership cannot customise a default; other workspaces cannot see the overrides", async () => {
    for (const u of [viewer, leader]) expect(await errorCode(ins(u, "Discovery", "array['item_code']", "base_view|'Discovery'"))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.saved_views where tenant_id = $1 and base_view is not null", [f.tenantA])).rowCount)).toBe(0);
  });
  it("customising and restoring a default is audited with actor and source", async () => {
    await ins(creator, "Delivery", "array['item_code']", "base_view|'Delivery'");
    const id = (await db.admin.query("select id from public.saved_views where tenant_id = $1 and base_view = 'Delivery'", [f.tenantA])).rows[0].id;
    await db.asUser(creator, (q) => q("delete from public.saved_views where id = $1", [id]), { commit: true, via: "UI" });
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'saved_views' and entity_id = $1 and field = 'base_view' order by at", [id]);
    expect(rows[0]).toMatchObject({ new: "Delivery", via: "UI", actor_id: creator });
    expect(rows[1]).toMatchObject({ old: "Delivery", new: null });
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

describe("pinned columns (0.30.0)", () => {
  it("a view stores up to four pinned column keys; more is refused", async () => {
    const ok = await db.asUser(f.alice, (q) => q("insert into public.saved_views (tenant_id, name, columns, pinned) values ($1, 'Pinned view', array['stack_rank','item_code','initiative_name','moscow'], array['moscow']) returning pinned", [f.tenantA]), { commit: true });
    expect(ok.rows[0].pinned).toEqual(["moscow"]);
    const code = await errorCode(db.asUser(f.alice, (q) => q("insert into public.saved_views (tenant_id, name, columns, pinned) values ($1, 'Too many', array['stack_rank'], array['a','b','c','d','e'])", [f.tenantA]), { commit: true }));
    expect(code).toBe("23514");
  });
});
