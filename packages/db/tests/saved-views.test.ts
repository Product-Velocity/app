import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let admin2: string, member: string, viewer: string, leader: string;

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  admin2 = await createUser(db, "admin2-views@example.test");
  member = await createUser(db, "member-views@example.test");
  viewer = await createUser(db, "viewer-views@example.test");
  leader = await createUser(db, "leader-views@example.test");
  await addMember(db, f.alice, f.tenantA, admin2, "admin");
  await addMember(db, f.alice, f.tenantA, member, "creator");
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
  it("everyone in the workspace reads workspace views; only admins write them", async () => {
    await add(f.alice, "Admin view");
    for (const u of [f.alice, admin2, member, viewer, leader]) {
      const n = await db.asUser(u, async (q) => (await q("select 1 from public.saved_views where tenant_id = $1 and owner_id is null", [f.tenantA])).rowCount);
      expect(n, u).toBeGreaterThan(0);
    }
    expect(await add(admin2, "Second admin view")).toBeTruthy();
  });
  it("creators, viewers and leadership cannot write workspace views; nobody sees another tenant's views", async () => {
    for (const u of [member, viewer, leader]) expect(await errorCode(add(u, `Nope ${u}`))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.saved_views where tenant_id = $1", [f.tenantA])).rowCount)).toBe(0);
    expect(await errorCode(add(f.alice, "Cross", "", f.tenantB))).toBe(DENIED);
  });
  it("only admins change and delete a workspace view", async () => {
    const id = await add(admin2, "To change");
    for (const u of [member, viewer, leader]) {
      expect(await db.asUser(u, async (q) => (await q("update public.saved_views set name = 'x' where id = $1", [id])).rowCount, { commit: true }), u).toBe(0);
      expect(await db.asUser(u, async (q) => (await q("delete from public.saved_views where id = $1", [id])).rowCount, { commit: true }), u).toBe(0);
    }
    expect(await db.asUser(f.alice, async (q) => (await q("update public.saved_views set name = 'Renamed', group_by = 'moscow', filters = '[{\"field\":\"moscow\",\"op\":\"is\",\"value\":\"Must\"}]'::jsonb, columns = array['item_code'] where id = $1", [id])).rowCount, { commit: true, via: "UI" })).toBe(1);
    expect(await db.asUser(admin2, async (q) => (await q("delete from public.saved_views where id = $1", [id])).rowCount, { commit: true })).toBe(1);
  });
});

describe("private views (0041)", () => {
  const priv = (user: string, name: string, tenant = f.tenantA, extra = "") =>
    db.asUser(user, async (q) => (await q(`insert into public.saved_views (tenant_id, name, columns, owner_id, visibility${extra ? ", " + extra.split("|")[0] : ""}) values ($1, $2, array['item_code','initiative_name'], $3, 'private'${extra ? ", " + extra.split("|")[1] : ""}) returning id`, [tenant, name, user])).rows[0].id as string, { commit: true, via: "UI" });

  it("any member, including view-only roles, creates, changes and deletes their own private view", async () => {
    for (const u of [member, viewer, leader, f.alice]) {
      const id = await priv(u, `Mine ${u}`);
      expect(await db.asUser(u, async (q) => (await q("update public.saved_views set name = $2, sort = '{\"field\":\"moscow\",\"dir\":\"asc\"}'::jsonb where id = $1", [id, `Renamed ${u}`])).rowCount, { commit: true }), u).toBe(1);
      expect(await db.asUser(u, async (q) => (await q("delete from public.saved_views where id = $1", [id])).rowCount, { commit: true }), u).toBe(1);
    }
  });
  it("nobody else reads, changes or deletes a private view: not a member of the same tenant, not an admin, not another tenant", async () => {
    const id = await priv(member, "Secret view");
    for (const u of [viewer, admin2, f.alice, f.bob]) {
      expect(await db.asUser(u, async (q) => (await q("select 1 from public.saved_views where id = $1", [id])).rowCount), u).toBe(0);
      expect(await db.asUser(u, async (q) => (await q("update public.saved_views set name = 'pwned' where id = $1", [id])).rowCount, { commit: true }), u).toBe(0);
      expect(await db.asUser(u, async (q) => (await q("delete from public.saved_views where id = $1", [id])).rowCount, { commit: true }), u).toBe(0);
    }
    expect(await db.asUser(member, async (q) => (await q("select 1 from public.saved_views where id = $1", [id])).rowCount)).toBe(1);
  });
  it("cannot be created for someone else or in another tenant", async () => {
    expect(await errorCode(db.asUser(member, (q) => q("insert into public.saved_views (tenant_id, name, columns, owner_id, visibility) values ($1, 'Forged', array['item_code'], $2, 'private')", [f.tenantA, viewer])))).toBe(DENIED);
    expect(await errorCode(priv(member, "Elsewhere", f.tenantB))).toBe(DENIED);
  });
  it("owner and visibility must agree; a private view is never customer-safe or a customised built-in", async () => {
    expect(await errorCode(db.asUser(member, (q) => q("insert into public.saved_views (tenant_id, name, columns, owner_id, visibility) values ($1, 'Bad', array['item_code'], $2, 'workspace')", [f.tenantA, member])))).toBe(CHECK);
    expect(await errorCode(db.admin.query("insert into public.saved_views (tenant_id, name, columns, visibility) values ($1, 'Bad2', array['item_code'], 'private')", [f.tenantA]))).toBe(CHECK);
    expect(await errorCode(priv(member, "Safe private", f.tenantA, "customer_safe|true"))).toBe(CHECK);
    expect(await errorCode(priv(member, "Override private", f.tenantA, "base_view|'Planning'"))).toBe(CHECK);
  });
  it("names are unique per owner; two people may use the same name, and a private view may share a workspace view's name", async () => {
    await priv(member, "Same name");
    expect(await errorCode(priv(member, " same NAME "))).toBe(UNIQUE);
    expect(await priv(viewer, "Same name")).toBeTruthy();
    await add(f.alice, "Shared name");
    expect(await priv(member, "Shared name")).toBeTruthy();
    expect(await errorCode(add(admin2, "shared name"))).toBe(UNIQUE);
  });
  it("an admin publishes their own private view as a workspace view; a member cannot", async () => {
    const id = await priv(f.alice, "To publish");
    expect(await db.asUser(f.alice, async (q) => (await q("update public.saved_views set owner_id = null, visibility = 'workspace' where id = $1", [id])).rowCount, { commit: true, via: "UI" })).toBe(1);
    const mine = await priv(member, "Try to publish");
    expect(await errorCode(db.asUser(member, (q) => q("update public.saved_views set owner_id = null, visibility = 'workspace' where id = $1", [mine])))).toBe(DENIED);
  });
});

describe("view caps (0041)", () => {
  it("the 26th private view for one person is refused with a readable message; others are not affected", async () => {
    const who = await createUser(db, "capped@example.test");
    await addMember(db, f.alice, f.tenantA, who, "viewer");
    const ins = (n: number) => db.asUser(who, (q) => q("insert into public.saved_views (tenant_id, name, columns, owner_id, visibility) values ($1, $2, array['item_code'], $3, 'private')", [f.tenantA, `Cap ${n}`, who]), { commit: true });
    for (let i = 1; i <= 25; i++) await ins(i);
    await expect(ins(26)).rejects.toThrow(/at most 25 private views/);
    expect(await errorCode(ins(26))).toBe(CHECK);
    expect(await db.asUser(member, (q) => q("insert into public.saved_views (tenant_id, name, columns, owner_id, visibility) values ($1, 'Cap other', array['item_code'], $2, 'private')", [f.tenantA, member]), { commit: true })).toBeTruthy();
  });
  it("the 26th workspace view (11 built-ins plus 14 added) is refused; customised built-ins do not count", async () => {
    const t = (await db.admin.query("insert into public.tenants (name) values ('Cap workspace') returning id")).rows[0].id as string;
    const owner = await createUser(db, "capadmin@example.test");
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [t, owner]);
    const ins = (n: number | string, base = "") => db.asUser(owner, (q) => q(`insert into public.saved_views (tenant_id, name, columns${base ? ", base_view" : ""}) values ($1, $2, array['item_code']${base ? ", $3" : ""})`, base ? [t, `WS ${n}`, base] : [t, `WS ${n}`]), { commit: true });
    for (let i = 1; i <= 14; i++) await ins(i);
    await expect(ins(15)).rejects.toThrow(/at most 25 views, including the 11 built-in/);
    await ins("override", "Planning");
  });
  it("making a private view a workspace view obeys the workspace cap", async () => {
    const t = (await db.admin.query("insert into public.tenants (name) values ('Cap workspace 2') returning id")).rows[0].id as string;
    const owner = await createUser(db, "capadmin2@example.test");
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [t, owner]);
    for (let i = 1; i <= 14; i++) await db.admin.query("insert into public.saved_views (tenant_id, name, columns) values ($1, $2, array['item_code'])", [t, `WS ${i}`]);
    const id = (await db.asUser(owner, (q) => q("insert into public.saved_views (tenant_id, name, columns, owner_id, visibility) values ($1, 'Mine', array['item_code'], $2, 'private') returning id", [t, owner]), { commit: true })).rows[0].id;
    await expect(db.asUser(owner, (q) => q("update public.saved_views set owner_id = null, visibility = 'workspace' where id = $1", [id]), { commit: true })).rejects.toThrow(/at most 25 views/);
  });
});

describe("view layouts (0041)", () => {
  const layout = (user: string, rows: unknown[], workspace = false, tenant = f.tenantA) =>
    db.asUser(user, (q) => q("select public.replace_view_layout($1, $2, $3::jsonb)", [tenant, workspace, JSON.stringify(rows)]), { commit: true, via: "UI" });
  const mine = async (user: string) => (await db.asUser(user, (q) => q("select builtin, in_bar, position from public.view_layouts where tenant_id = $1 and user_id is not null order by position", [f.tenantA]))).rows;

  it("any member, including view-only roles, sets their own layout; it is private to them", async () => {
    for (const u of [member, viewer, leader]) await layout(u, [{ builtin: "Planning", position: 0 }, { builtin: "Timeline", position: 1 }]);
    expect((await mine(viewer)).map((r) => r.builtin)).toEqual(["Planning", "Timeline"]);
    expect(await db.asUser(f.alice, async (q) => (await q("select 1 from public.view_layouts where tenant_id = $1 and user_id is not null", [f.tenantA])).rowCount)).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.view_layouts where tenant_id = $1", [f.tenantA])).rowCount)).toBe(0);
  });
  it("replacing a layout changes only that person's rows, and an empty list resets them to the workspace default", async () => {
    await layout(member, [{ builtin: "History", position: 0 }]);
    expect((await mine(viewer)).map((r) => r.builtin)).toEqual(["Planning", "Timeline"]);
    await layout(member, []);
    expect(await mine(member)).toEqual([]);
  });
  it("only admins write the workspace default; members' attempts are refused", async () => {
    for (const u of [member, viewer, leader]) expect(await errorCode(layout(u, [{ builtin: "Discovery", position: 0 }], true)), u).toBe(DENIED);
    await layout(f.alice, [{ builtin: "Prioritisation", position: 0 }, { builtin: "Timeline", position: 1, hidden: true, in_bar: false }], true);
    for (const u of [member, viewer, f.alice]) expect((await db.asUser(u, async (q) => (await q("select 1 from public.view_layouts where tenant_id = $1 and user_id is null", [f.tenantA])).rowCount)), u).toBe(2);
    expect(await errorCode(layout(f.alice, [{ builtin: "Planning", position: 0 }], true, f.tenantB))).toBe(DENIED);
  });
  it("points at a saved view or a built-in, not both and not neither; hidden is workspace-only; six in the bar at most", async () => {
    const v = (await db.admin.query("select id from public.saved_views where tenant_id = $1 and owner_id is null limit 1", [f.tenantA])).rows[0].id;
    expect(await errorCode(layout(member, [{ builtin: "Planning", view_id: v, position: 0 }]))).toBe(CHECK);
    expect(await errorCode(layout(member, [{ position: 0 }]))).toBe(CHECK);
    expect(await errorCode(layout(member, [{ builtin: "Planning", position: 0, hidden: true }]))).toBe(CHECK);
    const seven = ["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership", "Discovery"].map((b, i) => ({ builtin: b, position: i }));
    await expect(layout(member, seven)).rejects.toThrow(/bar is full \(6\)/);
    await layout(member, [{ view_id: v, position: 0 }]);
  });
  it("deleting a view removes it from every layout; layout writes are audited", async () => {
    const id = await add(admin2, "In a layout");
    await layout(member, [{ view_id: id, position: 0 }]);
    await db.asUser(admin2, (q) => q("delete from public.saved_views where id = $1", [id]), { commit: true });
    expect((await db.admin.query("select 1 from public.view_layouts where view_id = $1", [id])).rowCount).toBe(0);
    const { rows } = await db.admin.query("select via, actor_id from public.audit_log where entity = 'view_layouts' and actor_id = $1 limit 1", [member]);
    expect(rows[0]).toMatchObject({ via: "UI", actor_id: member });
  });
});

describe("saved views: constraints", () => {
  it("needs a name of 1 to 80 characters, unique in the workspace ignoring case and spaces", async () => {
    expect(await errorCode(add(admin2, "   "))).toBe(CHECK);
    expect(await errorCode(add(admin2, "x".repeat(81)))).toBe(CHECK);
    await add(admin2, "Planning board");
    expect(await errorCode(add(admin2, "  planning BOARD "))).toBe(UNIQUE);
    expect(await add(f.bob, "Planning board", "", f.tenantB)).toBeTruthy(); // another workspace may use the name
  });
  it("needs 1 to 200 columns, none empty", async () => {
    for (const cols of ["array[]::text[]", "array['a','']", "array['a',null]", `(select array_agg('c' || g) from generate_series(1, 201) g)`]) {
      expect(await errorCode(db.asUser(admin2, (q) => q(`insert into public.saved_views (tenant_id, name, columns) values ($1, 'Bad ' || $2::text, ${cols})`, [f.tenantA, cols.length]))), cols).toBe(CHECK);
    }
  });
  it("filters must be a list of at most 20; the group is optional", async () => {
    expect(await errorCode(db.asUser(admin2, (q) => q("insert into public.saved_views (tenant_id, name, columns, filters) values ($1, 'F1', array['a'], '{}'::jsonb)", [f.tenantA])))).toBe(CHECK);
    expect(await errorCode(db.asUser(admin2, (q) => q("insert into public.saved_views (tenant_id, name, columns, filters) values ($1, 'F2', array['a'], (select jsonb_agg(g) from generate_series(1, 21) g))", [f.tenantA])))).toBe(CHECK);
    expect(await errorCode(db.asUser(admin2, (q) => q("insert into public.saved_views (tenant_id, name, columns, group_by) values ($1, 'F3', array['a'], '')", [f.tenantA])))).toBe(CHECK);
    expect(await add(admin2, "Grouped", "group_by|'health'")).toBeTruthy();
  });
  it("tenant, admin2 and source cannot be set or changed through the API", async () => {
    const id = await add(admin2, "Locked columns");
    expect(await errorCode(db.asUser(admin2, (q) => q("update public.saved_views set tenant_id = $1 where id = $2", [f.tenantB, id])))).toBe(DENIED);
    expect(await errorCode(db.asUser(admin2, (q) => q("update public.saved_views set created_by = null where id = $1", [id])))).toBe(DENIED);
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
    await ins(admin2, "Safe view", "array['item_code','initiative_name','roadmap_category']", "customer_safe|true");
    for (const bad of ["array['item_code','value_12m']", "array['item_code','confidence']", "array['value_proposition','customers_requesting']", "array['stack_rank']"]) {
      expect(await errorCode(ins(admin2, `Unsafe ${bad}`, bad, "customer_safe|true")), bad).toBe(CHECK);
    }
    await ins(admin2, "Ordinary with value", "array['item_code','value_12m']", "customer_safe|false"); // an internal view may
  });
  it("turning customer-safe on for a view with commercial columns is refused", async () => {
    const id = await add(admin2, "Has value", "");
    await db.asUser(admin2, (q) => q("update public.saved_views set columns = array['item_code','value_12m'] where id = $1", [id]), { commit: true });
    expect(await errorCode(db.asUser(admin2, (q) => q("update public.saved_views set customer_safe = true where id = $1", [id])))).toBe(CHECK);
  });
  it("a default view can be customised once per workspace and only with a known name; deleting restores the default", async () => {
    await ins(admin2, "Planning", "array['item_code','start_date']", "base_view|'Planning'");
    expect(await errorCode(ins(f.alice, "Planning again", "array['item_code']", "base_view|'Planning'"))).toBe(UNIQUE);
    expect(await errorCode(ins(admin2, "Made up", "array['item_code']", "base_view|'Made up'"))).toBe(CHECK);
    expect(await ins(f.bob, "Planning", "array['item_code']", "base_view|'Planning'", f.tenantB)).toBeTruthy(); // another workspace
    expect(await db.asUser(admin2, async (q) => (await q("delete from public.saved_views where tenant_id = $1 and base_view = 'Planning'", [f.tenantA])).rowCount, { commit: true, via: "UI" })).toBe(1);
    await ins(admin2, "Planning", "array['item_code']", "base_view|'Planning'"); // can be customised again after a restore
  });
  it("the two views added by R-021 (Timeline, Cycle review) can be customised too; the check lists exactly ten names", async () => {
    await ins(admin2, "Timeline", "array['item_code']", "base_view|'Timeline'");
    await ins(admin2, "Cycle review", "array['item_code']", "base_view|'Cycle review'");
    expect(await errorCode(ins(admin2, "Timeline again", "array['item_code']", "base_view|'Timeline'"))).toBe(UNIQUE);
    const names = (await db.admin.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'saved_views_base_view_check'")).rows[0].d as string;
    expect((names.match(/'[^']+'::text/g) ?? []).length).toBe(10);
  });
  it("a customised default is never customer-safe, and base_view cannot be changed afterwards", async () => {
    expect(await errorCode(ins(admin2, "Leadership", "array['item_code']", "base_view, customer_safe|'Leadership', true"))).toBe(CHECK);
    const id = (await db.admin.query("select id from public.saved_views where tenant_id = $1 and base_view = 'Planning'", [f.tenantA])).rows[0].id;
    expect(await errorCode(db.asUser(admin2, (q) => q("update public.saved_views set base_view = 'Delivery' where id = $1", [id])))).toBe(DENIED);
  });
  it("viewers and leadership cannot customise a default; other workspaces cannot see the overrides", async () => {
    for (const u of [viewer, leader]) expect(await errorCode(ins(u, "Discovery", "array['item_code']", "base_view|'Discovery'"))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.saved_views where tenant_id = $1 and base_view is not null", [f.tenantA])).rowCount)).toBe(0);
  });
  it("customising and restoring a default is audited with actor and source", async () => {
    await ins(admin2, "Delivery", "array['item_code']", "base_view|'Delivery'");
    const id = (await db.admin.query("select id from public.saved_views where tenant_id = $1 and base_view = 'Delivery'", [f.tenantA])).rows[0].id;
    await db.asUser(admin2, (q) => q("delete from public.saved_views where id = $1", [id]), { commit: true, via: "UI" });
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'saved_views' and entity_id = $1 and field = 'base_view' order by at", [id]);
    expect(rows[0]).toMatchObject({ new: "Delivery", via: "UI", actor_id: admin2 });
    expect(rows[1]).toMatchObject({ old: "Delivery", new: null });
  });
});

describe("saved views: audit", () => {
  it("records create, each changed field, and delete with actor and source", async () => {
    const id = await add(admin2, "Audited view");
    await db.asUser(admin2, (q) => q("update public.saved_views set name = 'Audited view 2', group_by = 'moscow' where id = $1", [id]), { commit: true, via: "UI" });
    await db.asUser(admin2, (q) => q("delete from public.saved_views where id = $1", [id]), { commit: true, via: "UI" });
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'saved_views' and entity_id = $1 order by at, field", [id]);
    expect(rows.find((r) => r.field === "name" && r.new === "Audited view")).toMatchObject({ old: null, via: "UI", actor_id: admin2 });
    expect(rows.find((r) => r.field === "name" && r.new === "Audited view 2")).toMatchObject({ old: "Audited view" });
    expect(rows.find((r) => r.field === "group_by")).toMatchObject({ old: null, new: "moscow" });
    expect(rows.find((r) => r.field === "name" && r.new === null)).toMatchObject({ old: "Audited view 2" }); // delete
  });
});

describe("saved scopes (portfolio scope)", () => {
  it("a admin2 can create a scope with projects, rename it and delete it; the links go with it; writes are audited", async () => {
    const proj = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'Scope test project') returning id", [f.tenantA])).rows[0].id;
    const scope = await db.asUser(admin2, async (q) => {
      const s = (await q("insert into public.saved_scopes (tenant_id, name) values ($1, 'Customer-facing') returning id", [f.tenantA])).rows[0].id;
      await q("insert into public.saved_scope_projects (tenant_id, scope_id, project_id) values ($1, $2, $3), ($1, $2, $4)", [f.tenantA, s, proj, f.seedA.project]);
      return s as string;
    }, { commit: true, via: "UI" });
    expect((await db.admin.query("select count(*)::int as n from public.saved_scope_projects where scope_id = $1", [scope])).rows[0].n).toBe(2);
    await db.asUser(admin2, (q) => q("update public.saved_scopes set name = 'Customer-facing work' where id = $1", [scope]), { commit: true, via: "UI" });
    expect((await db.admin.query("select new from public.audit_log where entity = 'saved_scopes' and entity_id = $1 and field = 'name' order by at desc limit 1", [scope])).rows[0].new).toBe("Customer-facing work");
    expect(await errorCode(db.asUser(admin2, (q) => q("insert into public.saved_scope_projects (tenant_id, scope_id, project_id) values ($1, $2, $3)", [f.tenantA, scope, f.seedB.project])))).toBe("23503"); // another tenant's project
    expect(await db.asUser(admin2, async (q) => (await q("delete from public.saved_scopes where id = $1", [scope])).rowCount, { commit: true })).toBe(1);
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

describe("reset of all saved views (0042)", () => {
  it("deletes every saved view and customised built-in, in every workspace", async () => {
    await add(f.alice, "Before reset");
    await db.admin.query("insert into public.saved_views (tenant_id, name, columns, base_view) values ($1, 'Planning', array['item_code'], 'Planning') on conflict do nothing", [f.tenantB]);
    await db.admin.query(readFileSync(new URL("../migrations/0042_reset_saved_views.sql", import.meta.url), "utf8"));
    expect((await db.admin.query("select count(*)::int as n from public.saved_views")).rows[0].n).toBe(0);
  });
});
