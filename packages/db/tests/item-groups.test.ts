import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;

const DENIED = "42501";
const UNIQUE = "23505";
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-groups@example.test");
  viewer = await createUser(db, "viewer-groups@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
});
afterAll(async () => {
  await db.close();
});

const item = async (theme: string | null = null, tenant = f.tenantA, project = f.seedA.project) =>
  (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, theme) values ($1, 'Group test', $2, $3) returning id", [tenant, project, theme])).rows[0].id as string;
const setTheme = (user: string, id: string, theme: string | null) =>
  db.asUser(user, (q) => q("update public.items set theme = $1 where id = $2", [theme, id]), { commit: true, via: "UI" });
const groups = async (tenant = f.tenantA) =>
  (await db.admin.query("select id, name from public.item_groups where tenant_id = $1 order by lower(name)", [tenant])).rows as { id: string; name: string }[];
const themeOf = async (id: string) => (await db.admin.query("select theme from public.items where id = $1", [id])).rows[0].theme as string | null;
const groupId = async (name: string, tenant = f.tenantA) => (await groups(tenant)).find((g) => g.name === name)!.id;

describe("a group is created when someone types a new one", () => {
  it("setting Initiative Group to an unknown name by an editor adds it to the workspace list, audited", async () => {
    const id = await item();
    await setTheme(creator, id, "Onboarding");
    expect((await groups()).map((g) => g.name)).toContain("Onboarding");
    const { rows } = await db.admin.query("select via, actor_id from public.audit_log where entity = 'item_groups' and field = 'name' and (new #>> '{}') = 'Onboarding'");
    expect(rows[0]).toMatchObject({ via: "UI", actor_id: creator });
  });
  it("the same name in another case reuses the group and keeps its spelling; spaces are trimmed; blank clears", async () => {
    const id = await item();
    await setTheme(creator, id, "  onboarding ");
    expect(await themeOf(id)).toBe("Onboarding");
    expect((await groups()).filter((g) => g.name.toLowerCase() === "onboarding")).toHaveLength(1);
    await setTheme(creator, id, "   ");
    expect(await themeOf(id)).toBeNull();
  });
  it("a new item created with a new group adds the group too", async () => {
    await db.asUser(creator, (q) => q("insert into public.items (tenant_id, initiative_name, home_project_id, theme) values ($1, 'Born in a group', $2, 'Retention')", [f.tenantA, f.seedA.project]), { commit: true, via: "UI" });
    expect((await groups()).map((g) => g.name)).toContain("Retention");
  });
  it("names are unique per workspace ignoring case, limited to 120 characters, and another workspace may use the same name", async () => {
    expect(await errorCode(db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'ONBOARDING')", [f.tenantA]))).toBe(UNIQUE);
    expect(await errorCode(db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, $2)", [f.tenantA, "x".repeat(121)]))).toBe(CHECK);
    expect(await errorCode(db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, ' padded ')", [f.tenantA]))).toBe(CHECK);
    await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'Onboarding')", [f.tenantB]);
    expect((await groups(f.tenantB)).map((g) => g.name)).toContain("Onboarding");
  });
  it("viewers cannot add a group, and nobody sees or touches another workspace's groups", async () => {
    expect(await errorCode(db.asUser(viewer, (q) => q("insert into public.item_groups (tenant_id, name) values ($1, 'Nope')", [f.tenantA])))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_groups where tenant_id = $1", [f.tenantA])).rowCount)).toBe(0);
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.item_groups (tenant_id, name) values ($1, 'Cross')", [f.tenantB])))).toBe(DENIED);
  });
});

describe("usage counts for the tidy-up screen", () => {
  it("lists the workspace's groups with their number of initiatives, and nothing from another workspace", async () => {
    await item("Counted"); await item("Counted"); await item("Counted");
    const mine = await db.asUser(creator, async (q) => (await q("select name, items::int as items from public.item_group_usage($1)", [f.tenantA])).rows);
    expect(mine.find((r) => r.name === "Counted")).toMatchObject({ items: 3 });
    expect(mine.map((r) => r.name)).not.toContain("Foreign");
    expect(await db.asUser(f.bob, async (q) => (await q("select name from public.item_group_usage($1)", [f.tenantA])).rowCount)).toBe(0);
  });
});

describe("admins tidy up: rename, merge, retire", () => {
  it("rename changes the group and every item in it, one audited change per item", async () => {
    const a = await item("Billing"), b = await item("Billing"), other = await item("Payments");
    const gid = await groupId("Billing");
    const n = await db.asUser(f.alice, async (q) => (await q("select public.rename_item_group($1, 'Billing and invoices') as n", [gid])).rows[0].n, { commit: true, via: "UI" });
    expect(n).toBe(2);
    expect(await themeOf(a)).toBe("Billing and invoices");
    expect(await themeOf(b)).toBe("Billing and invoices");
    expect(await themeOf(other)).toBe("Payments");
    expect((await groups()).map((g) => g.name)).not.toContain("Billing");
    const { rows } = await db.admin.query("select entity_id, actor_id, via from public.audit_log where entity = 'items' and field = 'theme' and (old #>> '{}') = 'Billing' and (new #>> '{}') = 'Billing and invoices'");
    expect(rows.map((r) => r.entity_id).sort()).toEqual([a, b].sort());
    expect(rows[0]).toMatchObject({ actor_id: f.alice, via: "UI" });
  });
  it("rename to a name another group already has is refused and changes nothing", async () => {
    const a = await item("Alpha"); await item("Beta");
    const alpha = await groupId("Alpha");
    const err = await errorCode(db.asUser(f.alice, (q) => q("select public.rename_item_group($1, 'beta')", [alpha]), { commit: true }));
    expect(err).toBe(UNIQUE);
    expect(await themeOf(a)).toBe("Alpha");
  });
  it("only admins can rename, merge or retire; creators and viewers cannot", async () => {
    await item("Gamma"); await item("Delta");
    const g = await groupId("Gamma"), d = await groupId("Delta");
    for (const u of [creator, viewer]) {
      expect(await errorCode(db.asUser(u, (q) => q("select public.rename_item_group($1, 'X')", [g])))).toBe(DENIED);
      expect(await errorCode(db.asUser(u, (q) => q("select public.merge_item_groups($1, $2)", [g, d])))).toBe(DENIED);
      expect(await errorCode(db.asUser(u, (q) => q("select public.retire_item_group($1)", [g])))).toBe(DENIED);
    }
  });
  it("another workspace's admin cannot touch this workspace's groups", async () => {
    const g = await groupId("Gamma");
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.rename_item_group($1, 'X')", [g])))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.retire_item_group($1)", [g])))).toBe(DENIED);
  });
  it("merge moves the items into the other group, drops the first group and returns the moved items", async () => {
    const a = await item("Growth loops"), b = await item("Growth loops"), keep = await item("Growth");
    const from = await groupId("Growth loops"), into = await groupId("Growth");
    const moved = await db.asUser(f.alice, async (q) => (await q("select public.merge_item_groups($1, $2) as ids", [from, into])).rows[0].ids as string[], { commit: true, via: "UI" });
    expect([...moved].sort()).toEqual([a, b].sort());
    expect(await themeOf(a)).toBe("Growth");
    expect(await themeOf(keep)).toBe("Growth");
    expect((await groups()).map((g) => g.name)).not.toContain("Growth loops");
    const { rows } = await db.admin.query("select entity_id from public.audit_log where entity = 'items' and field = 'theme' and (old #>> '{}') = 'Growth loops' and (new #>> '{}') = 'Growth'");
    expect(rows).toHaveLength(2);
  });
  it("a merge can be undone: the group comes back with the items that are still in the target", async () => {
    const a = await item("Acquisition funnel"), b = await item("Acquisition funnel"); await item("Acquisition");
    const from = await groupId("Acquisition funnel"), into = await groupId("Acquisition");
    const moved = await db.asUser(f.alice, async (q) => (await q("select public.merge_item_groups($1, $2) as ids", [from, into])).rows[0].ids as string[], { commit: true, via: "UI" });
    await setTheme(creator, b, "Somewhere else"); // edited after the merge: must not be pulled back
    const back = await db.asUser(f.alice, async (q) => (await q("select public.restore_merged_group($1, 'Acquisition funnel', 'Acquisition', $2::uuid[]) as n", [f.tenantA, moved])).rows[0].n, { commit: true, via: "UI" });
    expect(back).toBe(1);
    expect(await themeOf(a)).toBe("Acquisition funnel");
    expect(await themeOf(b)).toBe("Somewhere else");
    expect((await groups()).map((g) => g.name)).toContain("Acquisition funnel");
  });
  it("merge refuses groups of different workspaces, and a group with itself", async () => {
    await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'Foreign') on conflict do nothing", [f.tenantB]);
    const foreign = await groupId("Foreign", f.tenantB), own = await groupId("Gamma");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.merge_item_groups($1, $2)", [own, foreign])))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.merge_item_groups($1, $1)", [own])))).toBe(CHECK);
  });
  it("retire removes an unused group and refuses one that has items", async () => {
    await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'Unused') on conflict do nothing", [f.tenantA]);
    await item("In use");
    const inUse = await groupId("In use");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.retire_item_group($1)", [inUse]), { commit: true }))).toBe("23503"); // still has items
    const unused = await groupId("Unused");
    await db.asUser(f.alice, (q) => q("select public.retire_item_group($1)", [unused]), { commit: true, via: "UI" });
    expect((await groups()).map((g) => g.name)).not.toContain("Unused");
    const { rows } = await db.admin.query("select actor_id from public.audit_log where entity = 'item_groups' and entity_id = $1 and field = 'name' and new is null", [unused]);
    expect(rows[0]).toMatchObject({ actor_id: f.alice });
  });
  it("direct updates and deletes of groups are only for admins through the functions", async () => {
    const g = await groupId("Gamma");
    expect(await errorCode(db.asUser(creator, (q) => q("update public.item_groups set name = 'Hacked' where id = $1", [g])))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.item_groups where id = $1", [g])))).toBe(DENIED);
  });
});
