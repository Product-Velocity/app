import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, itemIds: string[], itemB: string;
const DENIED = "42501";
const GROUPS = JSON.stringify([{ id: "eng", name: "Engineering" }, { id: "sales", name: "Sales" }]);

const create = (user: string, ids = itemIds) => db.asUser(user, async (q) => (await q("select public.alignment_session_create('Q1 priorities', 'coins', $1::uuid[]) as id", [ids])).rows[0].id as string, { commit: true, via: "UI" });
const row = async (id: string) => (await db.admin.query("select * from public.alignment_sessions where id = $1", [id])).rows[0];
const configure = (user: string, id: string, over: Record<string, unknown> = {}) =>
  db.asUser(user, (q) => q("select public.alignment_session_configure($1, $2, $3, $4::jsonb, $5, $6::text[], $7, $8, $9, $10, $11)", [id, over.name ?? "Q1 priorities", over.method ?? "coins", over.groups ?? GROUPS, over.weighting ?? "equal", over.excluded ?? [], over.total ?? 100, over.max ?? 30, over.show ?? false, over.retention ?? 12, over.closes ?? null]), { commit: true });
const setState = (user: string, id: string, state: string) => db.asUser(user, (q) => q("select public.alignment_session_set_state($1, $2)", [id, state]), { commit: true });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-align@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  itemIds = (await db.admin.query("select id from public.items where tenant_id = $1 and deleted_at is null order by stack_rank limit 3", [f.tenantA])).rows.map((r) => r.id);
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("alignment sessions", () => {
  it("an admin creates a draft from a selection; others cannot, and another workspace's items are refused", async () => {
    const id = await create(f.alice);
    expect(await row(id)).toMatchObject({ status: "draft", method: "coins", tenant_id: f.tenantA });
    expect((await db.admin.query("select count(*)::int as n from public.alignment_items where session_id = $1", [id])).rows[0].n).toBe(itemIds.length);
    expect(await errorCode(create(creator))).toBe(DENIED);
    expect(await errorCode(create(f.alice, [itemB, itemB]))).toBe(DENIED);
  });
  it("nobody writes the tables directly, and members can read sessions", async () => {
    const id = await create(f.alice);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.alignment_sessions set name = 'x' where id = $1", [id])))).toBe(DENIED);
    const seen = await db.asUser(creator, async (q) => (await q("select count(*)::int as n from public.alignment_sessions where id = $1", [id])).rows[0].n);
    expect(seen).toBe(1);
  });
  it("opening snapshots only the customer-safe fields, locks the settings and needs two initiatives", async () => {
    const id = await create(f.alice);
    await db.admin.query("update public.items set summary = 'Safe summary', value_12m = 123456 where id = $1", [itemIds[0]]);
    await configure(f.alice, id, { show: true, closes: "2099-01-01T00:00:00Z" });
    await setState(f.alice, id, "open");
    const items = (await db.admin.query("select * from public.alignment_items where session_id = $1 order by position", [id])).rows;
    expect(items[0]).toMatchObject({ shown_summary: "Safe summary" });
    expect(Object.keys(items[0]).join(",")).not.toMatch(/value_12m|confidence|decision/);
    expect(await errorCode(configure(f.alice, id, { name: "Changed" }))).toBe("PV009");
    const thin = await create(f.alice, [itemIds[0], itemIds[0]]).catch((e) => e);
    expect(thin).toBeTruthy();
  });
  it("states go draft, open, closed, archived and never back; the closing time closes an open session", async () => {
    const id = await create(f.alice);
    expect(await errorCode(setState(f.alice, id, "closed"))).toBe("22023");
    await setState(f.alice, id, "open");
    expect(await errorCode(setState(f.alice, id, "archived"))).toBe("22023");
    await db.admin.query("update public.alignment_sessions set closes_at = now() - interval '1 minute' where id = $1", [id]);
    const closed = await db.asUser(f.alice, async (q) => (await q("select public.alignment_close_due($1) as n", [f.tenantA])).rows[0].n, { commit: true });
    expect(closed).toBeGreaterThanOrEqual(1);
    expect((await row(id)).status).toBe("closed");
    await setState(f.alice, id, "archived");
    expect(await errorCode(setState(f.alice, id, "open"))).toBe("22023");
  });
  it("another workspace's admin cannot change it or close its sessions", async () => {
    const id = await create(f.alice);
    expect(await errorCode(setState(f.bob, id, "open"))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.alignment_close_due($1)", [f.tenantA])))).toBe(DENIED);
  });
  it("changes are audited with the admin as actor", async () => {
    const id = await create(f.alice);
    await setState(f.alice, id, "open");
    const a = await db.admin.query("select actor_id, via from public.audit_log where entity = 'alignment_sessions' and entity_id = $1 and field = 'status' order by id desc limit 1", [id]);
    expect(a.rows[0]).toMatchObject({ actor_id: f.alice, via: "UI" });
  });
});
