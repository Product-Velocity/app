import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let ana: string, ben: string, viewer: string, service: string, carl: string; // members of A, and carl of B only
let itemA: string, itemA2: string, itemB: string, connA: string, connB: string;
const DENIED = "42501";
const H = (c: string) => c.repeat(64);

const setName = (as: string, tenant: string, user: string, name: string | null, commit = true) => db.asUser(as, (q) => q("select public.set_github_username($1, $2, $3)", [tenant, user, name]), { commit });
const username = async (tenant: string, user: string) => (await db.admin.query("select github_username as u from public.tenant_members where tenant_id = $1 and user_id = $2", [tenant, user])).rows[0].u as string | null;
const assign = (as: string, item: string, ids: string[]) => db.asUser(as, (q) => q("select public.set_item_assignees($1, $2::uuid[])", [item, ids]), { commit: true });
const assigned = async (item: string) => (await db.admin.query("select assignee_ids as a from public.items where id = $1", [item])).rows[0].a as string[];
const ghApply = (conn: string, item: string, logins: string[] | null) => db.asService(async (q) => (await q("select public.github_apply_assignees($1, $2, $3::text[]) as r", [conn, item, logins])).rows[0].r as boolean, { commit: true });
const ghLogins = async (item: string) => (await db.admin.query("select gh_assignees as g from public.item_github_links where item_id = $1", [item])).rows[0].g as string[];
const pull = (actor: string, item: string, ids: string[], base: unknown = null) => db.asService(async (q) => (await q("select public.github_pull_assignees($1, $2, $3::uuid[], $4::jsonb) as r", [actor, item, ids, base === null ? null : JSON.stringify(base)])).rows[0].r as string[], { commit: true, via: "UI" });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  ana = await createUser(db, "ana-assign@example.test");
  ben = await createUser(db, "ben-assign@example.test");
  viewer = await createUser(db, "viewer-assign@example.test");
  service = await createUser(db, "service-assign@example.test");
  carl = await createUser(db, "carl-assign@example.test");
  await addMember(db, f.alice, f.tenantA, ana, "creator");
  await addMember(db, f.alice, f.tenantA, ben, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  await addMember(db, f.bob, f.tenantB, carl, "creator");
  await db.admin.query("delete from public.item_github_links");
  const ids = (await db.admin.query("select id from public.items where tenant_id = $1 order by stack_rank limit 2", [f.tenantA])).rows.map((r) => r.id as string);
  [itemA, itemA2] = ids;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  connB = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  for (const [t, i, c, n, mode] of [[f.tenantA, itemA, connA, 1, "push"], [f.tenantA, itemA2, connA, 2, "follow"], [f.tenantB, itemB, connB, 3, "push"]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', $6)", [t, i, c, n, 9500 + n, mode]);
  }
});
afterAll(async () => { await db.close(); });

describe("GitHub username of a member", () => {
  it("a person sets their own (a leading @ is dropped), an admin sets anyone's, and it is audited with the person", async () => {
    await setName(ana, f.tenantA, ana, "@Ana-GH");
    expect(await username(f.tenantA, ana)).toBe("Ana-GH");
    await setName(f.alice, f.tenantA, ben, "ben-gh");
    expect(await username(f.tenantA, ben)).toBe("ben-gh");
    const a = (await db.admin.query("select actor_id, new #>> '{}' as v from public.audit_log where entity = 'tenant_members' and field = 'github_username' and new #>> '{}' = 'ben-gh' order by id desc limit 1")).rows[0];
    expect(a).toMatchObject({ actor_id: f.alice, v: "ben-gh" });
  });
  it("is unique in a workspace whatever the case, but another workspace may use the same name", async () => {
    expect(await errorCode(setName(ben, f.tenantA, ben, "ANA-gh"))).toBe("23505");
    await setName(carl, f.tenantB, carl, "ana-gh");
    expect(await username(f.tenantB, carl)).toBe("ana-gh");
  });
  it("refuses what is not a GitHub username, and can be cleared", async () => {
    for (const bad of ["-lead", "trail-", "two--hyphens", "with space", "a".repeat(40), "semi;colon", "ünï"]) expect(await errorCode(setName(ben, f.tenantA, ben, bad)), bad).toBe("22023");
    await setName(ben, f.tenantA, ben, "  ");
    expect(await username(f.tenantA, ben)).toBeNull();
    await setName(f.alice, f.tenantA, ben, "ben-gh");
  });
  it("nobody changes someone else's, or a member of another workspace, unless an admin of that workspace", async () => {
    expect(await errorCode(setName(ana, f.tenantA, ben, "stolen"))).toBe(DENIED);
    expect(await errorCode(setName(f.alice, f.tenantB, carl, "stolen"))).toBe(DENIED); // an admin of A has no say in B
    expect(await errorCode(setName(carl, f.tenantA, carl, "x"))).toBe("P0002"); // not a member of A: nothing is written
    expect(await errorCode(setName(f.alice, f.tenantA, carl, "x"))).toBe("P0002"); // carl is not a member of A
    expect(await username(f.tenantA, ben)).toBe("ben-gh");
  });
  it("cannot be written directly by a signed-in user", async () => {
    expect(await errorCode(db.asUser(ana, (q) => q("update public.tenant_members set github_username = 'direct' where tenant_id = $1 and user_id = $2", [f.tenantA, ana])))).toBe(DENIED);
  });
});

describe("assignees in Product Velocity", () => {
  it("creators assign members of the workspace, audited, in a stable order without duplicates", async () => {
    await assign(ana, itemA, [ben, ana, ben]);
    expect(await assigned(itemA)).toEqual([ana, ben].sort());
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'assignee_ids' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ actor_id: ana });
  });
  it("viewers, service accounts and strangers cannot assign, and only members can be assigned", async () => {
    const before = await assigned(itemA);
    for (const who of [viewer, service, carl]) expect(await errorCode(assign(who, itemA, [ana])), who).toBe(DENIED);
    expect(await errorCode(assign(ana, itemA, [carl]))).toBe("22023"); // carl belongs to workspace B only
    expect(await errorCode(assign(ana, itemB, [carl]))).toBe(DENIED); // an item of another workspace
    expect(await errorCode(assign(ana, itemA, Array.from({ length: 11 }, () => crypto.randomUUID())))).toBe("22023");
    expect(await assigned(itemA)).toEqual(before);
  });
  it("cannot be written directly, and another workspace cannot read it", async () => {
    expect(await errorCode(db.asUser(ana, (q) => q("update public.items set assignee_ids = '{}' where id = $1", [itemA])))).toBe(DENIED);
    expect(await db.asUser(f.bob, async (q) => (await q("select assignee_ids from public.items where id = $1", [itemA])).rowCount)).toBe(0);
  });
});

describe("what GitHub shows, stored by the server", () => {
  it("stores lower-case sorted logins once, only when they change, audited as GitHub", async () => {
    expect(await ghApply(connA, itemA, ["Ben-GH", "ana-gh", "ana-GH", " "])).toBe(true);
    expect(await ghLogins(itemA)).toEqual(["ana-gh", "ben-gh"]);
    expect(await ghApply(connA, itemA, ["ana-gh", "ben-gh"])).toBe(false);
    expect(await ghApply(connA, itemA, [])).toBe(true);
    expect(await ghLogins(itemA)).toEqual([]);
    const a = (await db.admin.query("select via from public.audit_log where entity = 'item_github_links' and field = 'gh_assignees' order by id desc limit 1")).rows[0];
    expect(a.via).toBe("GitHub webhook");
  });
  it("touches only a link of that connection, and users cannot call it or write the column", async () => {
    expect(await ghApply(connA, itemB, ["x"])).toBe(false);
    expect(await ghApply(connB, itemA, ["x"])).toBe(false);
    expect(await errorCode(db.asUser(ana, (q) => q("select public.github_apply_assignees($1, $2, '{x}')", [connA, itemA])))).toBe(DENIED);
    expect(await errorCode(db.asUser(ana, (q) => q("update public.item_github_links set gh_assignees = '{x}' where item_id = $1", [itemA])))).toBe(DENIED);
  });
});

describe("taking assignees over from GitHub", () => {
  it("replaces the assignees with the chosen members, audited with the person, and records the base", async () => {
    const replaced = await pull(ana, itemA, [ben], { assignees: H("a") });
    expect(replaced).toEqual([ana, ben].sort());
    expect(await assigned(itemA)).toEqual([ben]);
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'assignee_ids' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ actor_id: ana, via: "UI" });
    expect((await db.admin.query("select sync_base from public.item_github_links where item_id = $1", [itemA])).rows[0].sync_base).toEqual({ assignees: H("a") });
  });
  it("refuses people of another workspace (nothing is created from GitHub), roles that may not write, follow links and too many", async () => {
    const before = await assigned(itemA);
    expect(await errorCode(pull(ana, itemA, [carl]))).toBe("22023");
    for (const who of [viewer, service, carl]) expect(await errorCode(pull(who, itemA, [ana])), who).toBe(DENIED);
    expect(await errorCode(pull(ana, itemA2, [ana]))).toBe("P0002");
    expect(await errorCode(pull(ana, itemB, [carl]))).toBe(DENIED);
    expect(await errorCode(pull(ana, itemA, Array.from({ length: 11 }, () => crypto.randomUUID())))).toBe("22023");
    expect(await assigned(itemA)).toEqual(before);
  });
  it("is not callable by signed-in users, and the base accepts the assignees key only as a hash", async () => {
    expect(await errorCode(db.asUser(ana, (q) => q("select public.github_pull_assignees($1, $2, '{}', null)", [ana, itemA])))).toBe(DENIED);
    await expect(db.asService((q) => q("select public.github_record_base($1, $2, $3::jsonb)", [ana, itemA, JSON.stringify({ assignees: "ana-gh" })]), { commit: true })).rejects.toBeTruthy();
  });
});
