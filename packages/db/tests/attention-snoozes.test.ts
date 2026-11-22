import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Needs attention snoozes: a reason of an initiative hidden until a date (or dismissed). Only a view filter; audited; Creators and above change it.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, itemId: string;
const DENIED = "42501";
const commit = { commit: true, via: "UI" } as const;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "snooze-creator@example.test");
  viewer = await createUser(db, "snooze-viewer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  itemId = (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Snooze item', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id;
});
afterAll(async () => { await db.close(); });

describe("attention_snoozes", () => {
  it("a Creator snoozes and dismisses; it is audited with the person and the source", async () => {
    await db.asUser(creator, (q) => q("insert into public.attention_snoozes (tenant_id, item_id, kind, snoozed_until, note) values ($1, $2, 'stalled', current_date + 14, 'Waiting for the vendor')", [f.tenantA, itemId]), commit);
    await db.asUser(creator, (q) => q("update public.attention_snoozes set snoozed_until = null where item_id = $1 and kind = 'stalled'", [itemId]), commit);
    const row = (await db.admin.query("select snoozed_until, created_by, created_via from public.attention_snoozes where item_id = $1", [itemId])).rows[0];
    expect(row).toMatchObject({ snoozed_until: null, created_by: creator, created_via: "UI" });
    const audit = (await db.admin.query("select field, actor_id, via from public.audit_log where entity = 'attention_snoozes' and field = 'snoozed_until' and actor_id is not null order by id")).rows;
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.every((a) => a.actor_id === creator && a.via === "UI")).toBe(true);
  });

  it("snooze_attention changes an existing snooze instead of doubling it, and a Viewer cannot call it", async () => {
    await db.asUser(creator, (q) => q("select public.snooze_attention($1, array[$2]::uuid[], 'no-health', current_date + 3, 'First')", [f.tenantA, itemId]), commit);
    await db.asUser(creator, (q) => q("select public.snooze_attention($1, array[$2]::uuid[], 'no-health', null, '  ')", [f.tenantA, itemId]), commit);
    const rows = (await db.admin.query("select snoozed_until, note from public.attention_snoozes where item_id = $1 and kind = 'no-health'", [itemId])).rows;
    expect(rows).toEqual([{ snoozed_until: null, note: null }]);
    expect(await errorCode(db.asUser(viewer, (q) => q("select public.snooze_attention($1, array[$2]::uuid[], 'stale-issues', null)", [f.tenantA, itemId]), commit))).toBe(DENIED);
    // an initiative of another workspace is never matched
    const n = await db.asUser(creator, async (q) => (await q("select public.snooze_attention($1, array[$2]::uuid[], 'stale-issues', null) as n", [f.tenantB, itemId])).rows[0].n as number, commit);
    expect(n).toBe(0);
    await db.admin.query("delete from public.attention_snoozes where item_id = $1 and kind = 'no-health'", [itemId]);
  });

  it("one row per initiative and reason", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.attention_snoozes (tenant_id, item_id, kind) values ($1, $2, 'stalled')", [f.tenantA, itemId]), commit))).toBe("23505");
  });

  it("an unknown reason is refused", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.attention_snoozes (tenant_id, item_id, kind) values ($1, $2, 'made-up')", [f.tenantA, itemId]), commit))).toBe("23514");
  });

  it("a Viewer can read but not snooze, and cannot remove one", async () => {
    const seen = await db.asUser(viewer, async (q) => (await q("select count(*)::int as n from public.attention_snoozes where item_id = $1", [itemId])).rows[0].n as number);
    expect(seen).toBe(1);
    expect(await errorCode(db.asUser(viewer, (q) => q("insert into public.attention_snoozes (tenant_id, item_id, kind) values ($1, $2, 'no-health')", [f.tenantA, itemId]), commit))).toBe(DENIED);
    await db.asUser(viewer, (q) => q("delete from public.attention_snoozes where item_id = $1", [itemId]), commit);
    expect((await db.admin.query("select count(*)::int as n from public.attention_snoozes where item_id = $1", [itemId])).rows[0].n).toBe(1);
  });

  it("the other workspace's member sees nothing", async () => {
    const n = await db.asUser(f.bob, async (q) => (await q("select count(*)::int as n from public.attention_snoozes where item_id = $1", [itemId])).rows[0].n as number);
    expect(n).toBe(0);
  });

  it("a Creator brings a dismissed reason back by deleting the row", async () => {
    await db.asUser(creator, (q) => q("delete from public.attention_snoozes where item_id = $1 and kind = 'stalled'", [itemId]), commit);
    expect((await db.admin.query("select count(*)::int as n from public.attention_snoozes where item_id = $1", [itemId])).rows[0].n).toBe(0);
  });
});
