import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
const DENIED = "42501";
const UNIQUE = "23505";
const CHECK = "23514";
const GUARD = "PV005";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-gh@example.test");
  service = await createUser(db, "service-gh@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  // start from a clean slate: remove the seeded connection so the tests control the state
  await db.admin.query("delete from public.item_github_links");
  await db.admin.query("delete from public.github_connections");
});
afterAll(async () => {
  await db.close();
});

const start = (user: string, tenant: string, account = "acme-corp", via = "UI") =>
  db.asUser(user, async (q) => (await q("insert into public.github_connections (tenant_id, expected_account) values ($1, $2) returning id", [tenant, account])).rows[0].id as string, { commit: true, via });
const conn = async (id: string) => (await db.admin.query("select * from public.github_connections where id = $1", [id])).rows[0];
const reset = async () => {
  await db.admin.query("delete from public.item_github_links");
  await db.admin.query("delete from public.github_connections");
};

describe("starting a connection", () => {
  it("a human admin starts one; it begins as requested with no installation", async () => {
    await reset();
    const id = await start(f.alice, f.tenantA);
    expect(await conn(id)).toMatchObject({ state: "requested", installation_id: null, created_by: f.alice, created_via: "UI" });
  });
  it("creators, viewers, service accounts and Claude cannot start one", async () => {
    await reset();
    expect(await errorCode(start(creator, f.tenantA))).toBe(DENIED);
    expect(await errorCode(start(f.carol, f.tenantA))).toBe(DENIED);
    expect(await errorCode(start(service, f.tenantA))).toBe(DENIED);
    expect(await errorCode(start(f.alice, f.tenantA, "acme-corp", "Claude MCP"))).toBe(DENIED);
  });
  it("another workspace's admin cannot start one for this workspace", async () => {
    await reset();
    expect(await errorCode(start(f.bob, f.tenantA))).toBe(DENIED);
  });
  it("only one open connection per workspace, and the organisation name must look like a GitHub login", async () => {
    await reset();
    await start(f.alice, f.tenantA);
    expect(await errorCode(start(f.alice, f.tenantA, "other-org"))).toBe(UNIQUE);
    await reset();
    for (const bad of ["", "-lead", "has space", "a/b", "x".repeat(40)]) expect(await errorCode(start(f.alice, f.tenantA, bad)), bad).toBe(CHECK);
  });
  it("a signed-in user cannot set state, installation or any other column on insert", async () => {
    await reset();
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.github_connections (tenant_id, expected_account, state, installation_id) values ($1, 'acme', 'connected', 5)", [f.tenantA])))).toBe(DENIED);
  });
});

describe("only the server moves a connection to connected", () => {
  it("signed-in users, even admins, cannot update or delete a connection", async () => {
    await reset();
    const id = await start(f.alice, f.tenantA);
    for (const sql of ["update public.github_connections set state = 'connected', installation_id = 1 where id = $1", "update public.github_connections set expected_account = 'x' where id = $1", "delete from public.github_connections where id = $1"]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(sql, [id]), { commit: true })), sql).toBe(DENIED);
    }
    expect((await conn(id)).state).toBe("requested");
  });
  it("a connected state needs an installation id, and one installation belongs to one workspace", async () => {
    await reset();
    const a = await start(f.alice, f.tenantA);
    expect(await errorCode(db.asService((q) => q("update public.github_connections set state = 'connected' where id = $1", [a]), { commit: true, via: "GitHub webhook" }))).toBe(CHECK);
    await db.asService((q) => q("update public.github_connections set state = 'connected', installation_id = 42, account_login = 'acme-corp' where id = $1", [a]), { commit: true, via: "GitHub webhook" });
    const b = await start(f.bob, f.tenantB);
    expect(await errorCode(db.asService((q) => q("update public.github_connections set state = 'connected', installation_id = 42 where id = $1", [b]), { commit: true, via: "GitHub webhook" }))).toBe(UNIQUE);
  });
  it("every change is audited with the actor and the source", async () => {
    await reset();
    const id = await start(f.alice, f.tenantA);
    await db.asService((q) => q("update public.github_connections set state = 'connected', installation_id = 7 where id = $1", [id]), { commit: true, via: "GitHub webhook" });
    const { rows } = await db.admin.query("select field, new, via, actor_id from public.audit_log where entity = 'github_connections' and entity_id = $1 and field = 'state' order by id", [id]);
    expect(rows.map((r) => [r.new, r.via])).toEqual([["requested", "UI"], ["connected", "GitHub webhook"]]);
    expect(rows[0].actor_id).toBe(f.alice);
    expect(rows[1].actor_id).toBeNull();
  });
});

describe("repositories and project defaults", () => {
  const connect = async () => {
    await reset();
    const id = await start(f.alice, f.tenantA);
    await db.asService((q) => q("update public.github_connections set state = 'connected', installation_id = 9 where id = $1", [id]), { commit: true, via: "GitHub webhook" });
    await db.asService((q) => q("insert into public.github_repositories (tenant_id, connection_id, github_repo_id, full_name) values ($1, $2, 1, 'Acme/Roadmap'), ($1, $2, 2, 'Acme/Other')", [f.tenantA, id]), { commit: true, via: "GitHub webhook" });
    return id;
  };
  const project = async () => (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
  const setRepo = (user: string, id: string, repo: string | null) => db.asUser(user, (q) => q("update public.projects set default_repo = $2 where id = $1", [id, repo]), { commit: true });

  it("members read the repositories; nobody signed in can write them", async () => {
    await connect();
    for (const u of [f.alice, creator, f.carol]) expect(await db.asUser(u, async (q) => (await q("select 1 from public.github_repositories")).rowCount), u).toBe(2);
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.github_repositories (tenant_id, connection_id, github_repo_id, full_name) select tenant_id, id, 3, 'a/b' from public.github_connections")))).toBe(DENIED);
    expect(await db.asUser(f.alice, async (q) => (await q("update public.github_repositories set removed_at = now()")).rowCount, { commit: true }).catch(() => -1)).not.toBe(2);
    expect((await db.admin.query("select count(*)::int as n from public.github_repositories where removed_at is not null")).rows[0].n).toBe(0);
  });
  it("a project default repository must be an active repository of the connection (case-insensitive)", async () => {
    await connect();
    const p = await project();
    await setRepo(f.alice, p, "acme/roadmap");
    expect((await db.admin.query("select default_repo from public.projects where id = $1", [p])).rows[0].default_repo).toBe("acme/roadmap");
    expect(await errorCode(setRepo(f.alice, p, "Acme/Unknown"))).toBe(GUARD);
    await db.admin.query("update public.github_repositories set removed_at = now() where full_name = 'Acme/Other'");
    expect(await errorCode(setRepo(f.alice, p, "Acme/Other"))).toBe(GUARD);
    await setRepo(f.alice, p, null);
  });
  it("disconnect clears project defaults, marks repositories removed, and is admin-only", async () => {
    const id = await connect();
    const p = await project();
    await setRepo(f.alice, p, "Acme/Roadmap");
    for (const u of [creator, f.carol, service, f.bob]) {
      expect(await errorCode(db.asUser(u, (q) => q("select public.github_disconnect($1)", [f.tenantA]), { commit: true })), u).toBe(DENIED);
    }
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.github_disconnect($1)", [f.tenantA]), { commit: true, via: "Claude MCP" }))).toBe(DENIED);
    await db.asUser(f.alice, (q) => q("select public.github_disconnect($1)", [f.tenantA]), { commit: true });
    expect((await conn(id)).state).toBe("disconnected");
    expect((await db.admin.query("select default_repo from public.projects where id = $1", [p])).rows[0].default_repo).toBeNull();
    expect((await db.admin.query("select count(*)::int as n from public.github_repositories where removed_at is null")).rows[0].n).toBe(0);
    // a fresh connection can be started again
    expect(await start(f.alice, f.tenantA)).toBeTruthy();
  });
});

describe("repository access: some repositories are never written to", () => {
  const setup = async () => {
    await reset();
    const id = await start(f.alice, f.tenantA);
    await db.asService((q) => q("update public.github_connections set state = 'connected', installation_id = 21 where id = $1", [id]), { commit: true, via: "GitHub webhook" });
    await db.asService((q) => q("insert into public.github_repositories (tenant_id, connection_id, github_repo_id, full_name, is_private, access) values ($1, $2, 1, 'Acme/Private', true, 'read_write'), ($1, $2, 2, 'Acme/Public', false, 'read_only')", [f.tenantA, id]), { commit: true, via: "GitHub webhook" });
    return id;
  };
  const project = async () => (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
  const repoId = async (name: string) => (await db.admin.query("select id from public.github_repositories where full_name = $1", [name])).rows[0].id as string;
  const setAccess = (user: string, id: string, access: string, via = "UI") => db.asUser(user, (q) => q("select public.github_set_repo_access($1, $2)", [id, access]), { commit: true, via });

  it("a read-only repository cannot be a project's default, a writable one can", async () => {
    await setup();
    const p = await project();
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.projects set default_repo = 'Acme/Public' where id = $1", [p]), { commit: true }))).toBe(GUARD);
    await db.asUser(f.alice, (q) => q("update public.projects set default_repo = 'Acme/Private' where id = $1", [p]), { commit: true });
    expect((await db.admin.query("select default_repo from public.projects where id = $1", [p])).rows[0].default_repo).toBe("Acme/Private");
  });
  it("only a human admin changes access; making a repository read-only clears project defaults that use it", async () => {
    await setup();
    const p = await project();
    await db.admin.query("update public.projects set default_repo = 'Acme/Private' where id = $1", [p]);
    const id = await repoId("Acme/Private");
    for (const u of [creator, f.carol, service, f.bob]) expect(await errorCode(setAccess(u, id, "read_only")), u).toBe(DENIED);
    expect(await errorCode(setAccess(f.alice, id, "read_only", "Claude MCP"))).toBe(DENIED);
    expect(await errorCode(setAccess(f.alice, id, "sideways"))).toBe("22023");
    await setAccess(f.alice, id, "read_only");
    expect((await db.admin.query("select access from public.github_repositories where id = $1", [id])).rows[0].access).toBe("read_only");
    expect((await db.admin.query("select default_repo from public.projects where id = $1", [p])).rows[0].default_repo).toBeNull();
    await setAccess(f.alice, id, "read_write");
    expect(await db.asUser(f.alice, async (q) => (await q("select access from public.github_repositories where id = $1", [id])).rows[0].access)).toBe("read_write");
  });
  it("signed-in users cannot edit the access column directly", async () => {
    await setup();
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.github_repositories set access = 'read_write'")))).toBe(DENIED);
  });
});
