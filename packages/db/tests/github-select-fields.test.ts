import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #513: github_apply_select_pull (Health and Initiative Status taken over from the board) and the sync base that accepts their keys.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string, bob: string;
let item: string, follow: string, otherTenantItem: string, connA: string, connB: string;
const DENIED = "42501";
const BAD = "22023";
const H = (c: string) => c.repeat(64);

const pull = (actor: string, id: string, fields: unknown, base: unknown = null) =>
  db.asService((q) => q("select public.github_apply_select_pull($1, $2, $3::jsonb, $4::jsonb) as r", [actor, id, JSON.stringify(fields), base === null ? null : JSON.stringify(base)]).then((r) => r.rows[0].r as Record<string, unknown>), { commit: true, via: "UI" });
const row = async (id: string) => (await db.admin.query("select health, initiative_status, initiative_phase, value_12m from public.items where id = $1", [id])).rows[0];
const link = async (id: string) => (await db.admin.query("select sync_base from public.item_github_links where item_id = $1", [id])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-gsf@example.test");
  viewer = await createUser(db, "viewer-gsf@example.test");
  service = await createUser(db, "service-gsf@example.test");
  bob = f.bob;
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  await db.admin.query("delete from public.item_github_links");
  const ids = (await db.admin.query("select id from public.items where tenant_id = $1 order by stack_rank limit 2", [f.tenantA])).rows.map((r) => r.id as string);
  [item, follow] = ids as [string, string];
  otherTenantItem = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  connB = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  for (const [t, i, c, n, mode] of [[f.tenantA, item, connA, 11, "push"], [f.tenantA, follow, connA, 12, "follow"], [f.tenantB, otherTenantItem, connB, 13, "push"]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4::int, $5::bigint, 'https://github.com/Acme/App/issues/' || ($4::int)::text, 'synced', $6)", [t, i, c, n, n * 100, mode]);
  }
  await db.admin.query("update public.items set health = 'On Track', initiative_status = 'Active', initiative_phase = 'Build' where id = $1", [item]);
});
afterAll(async () => { await db.close(); });

describe("github_apply_select_pull", () => {
  it("takes over Health, returns the old value, records the base (hashes) and audits the person with source UI", async () => {
    const r = await pull(creator, item, { health: "At Risk" }, { health: H("a") });
    expect(r).toEqual({ health: "On Track" });
    expect(await row(item)).toMatchObject({ health: "At Risk", initiative_status: "Active", initiative_phase: "Build" });
    expect((await link(item)).sync_base).toEqual({ health: H("a") });
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'health' order by id desc limit 1", [item])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
  });
  it("takes over Initiative Status", async () => {
    await pull(creator, item, { initiative_status: "On hold" }, { initiative_status: H("b") });
    expect((await row(item)).initiative_status).toBe("On hold");
    expect((await link(item)).sync_base).toEqual({ health: H("a"), initiative_status: H("b") });
  });
  it("NEVER takes over Initiative Phase, Build Status or a commercial field", async () => {
    const before = await row(item);
    for (const fields of [{ initiative_phase: "Test" }, { status: "Done" }, { value_12m: "1" }, { decision: "Go" }, { health: "Blocked", initiative_phase: "Test" }]) {
      expect(await errorCode(pull(creator, item, fields)), JSON.stringify(fields)).toBe(BAD);
    }
    expect(await row(item)).toEqual(before);
  });
  it("refuses a value the item does not allow, a viewer, a service account, a follow link and another workspace's item", async () => {
    await expect(pull(creator, item, { health: "Great" })).rejects.toBeDefined();
    expect(await errorCode(pull(viewer, item, { health: "Blocked" }))).toBe(DENIED);
    expect(await errorCode(pull(service, item, { health: "Blocked" }))).toBe(DENIED);
    expect(await errorCode(pull(bob, item, { health: "Blocked" }))).toBe(DENIED);
    expect(await errorCode(pull(creator, follow, { health: "Blocked" }))).toBe("P0002");
    expect(await errorCode(pull(creator, otherTenantItem, { health: "Blocked" }))).toBe(DENIED);
  });
});

describe("the sync base accepts the new keys and nothing else new", () => {
  it("accepts health and initiative_status hashes, refuses initiative_phase and rubbish", async () => {
    const ok = (b: unknown) => db.admin.query("select public.sync_base_valid($1::jsonb) as v", [JSON.stringify(b)]).then((r) => r.rows[0].v as boolean);
    expect(await ok({ health: H("a"), initiative_status: H("b"), priority: H("c"), assignees: H("d") })).toBe(true);
    expect(await ok({ initiative_phase: H("a") })).toBe(false);
    expect(await ok({ health: "not-a-hash" })).toBe(false);
  });
});
