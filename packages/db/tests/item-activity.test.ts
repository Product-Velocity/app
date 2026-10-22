import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-activity@example.test");
  viewer = await createUser(db, "viewer-activity@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
});
afterAll(async () => {
  await db.close();
});

const activity = (user: string, item: string) =>
  db.asUser(user, async (q) => (await q("select * from public.item_activity($1)", [item])).rows as { entity: string; entity_id: string; field: string; old: unknown; new: unknown; actor_id: string | null; via: string }[]);
const fresh = async () =>
  (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Activity test', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;

describe("item_activity", () => {
  it("returns the changes of one item with who, source and old and new values, newest first", async () => {
    const id = await fresh();
    await db.asUser(creator, (q) => q("update public.items set health = 'At Risk' where id = $1", [id]), { commit: true, via: "UI" });
    await db.asUser(creator, (q) => q("update public.items set effort = 'M' where id = $1", [id]), { commit: true, via: "API" });
    const rows = await activity(viewer, id); // a viewer may read the history
    const health = rows.find((r) => r.field === "health")!;
    expect(health).toMatchObject({ entity: "items", new: "At Risk", actor_id: creator, via: "UI" });
    expect(rows.find((r) => r.field === "effort")).toMatchObject({ new: "M", via: "API" });
    expect(rows.findIndex((r) => r.field === "effort")).toBeLessThan(rows.findIndex((r) => r.field === "health")); // newest first
    expect(rows.every((r) => !["updated_at", "created_by", "tenant_id"].includes(r.field))).toBe(true);
  });
  it("includes tags, links and other related rows of this item, also after they are removed, and nothing of other items", async () => {
    const id = await fresh(), other = await fresh();
    const tag = await db.asUser(creator, async (q) => (await q("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'urgent') returning id", [f.tenantA, id])).rows[0].id as string, { commit: true, via: "UI" });
    await db.asUser(creator, (q) => q("insert into public.item_links (tenant_id, item_id, label, url) values ($1, $2, 'PRD', 'https://example.test/prd')", [f.tenantA, other]), { commit: true, via: "UI" });
    await db.asUser(creator, (q) => q("delete from public.item_tags where id = $1", [tag]), { commit: true, via: "UI" });
    const rows = await activity(creator, id);
    const tagRows = rows.filter((r) => r.entity === "item_tags" && r.entity_id === tag);
    expect(tagRows.some((r) => r.field === "value" && r.new === "urgent")).toBe(true); // added
    expect(tagRows.some((r) => r.field === "value" && r.old === "urgent" && r.new === null)).toBe(true); // removed
    expect(rows.some((r) => r.entity === "item_links")).toBe(false); // another item's link
  });
  it("refuses an item of another workspace and an unknown item", async () => {
    const id = await fresh();
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.item_activity($1)", [id])))).toBe("42501");
    expect(await errorCode(db.asUser(creator, (q) => q("select * from public.item_activity($1)", ["00000000-0000-0000-0000-000000000000"])))).toBe("42501");
    expect(await errorCode(db.asAnon((q) => q("select * from public.item_activity($1)", [id])))).toBe("42501");
  });
  it("is limited to the number of rows asked for", async () => {
    const id = await fresh();
    for (const e of ["XS", "S", "M", "L"]) await db.asUser(creator, (q) => q("update public.items set effort = $1 where id = $2", [e, id]), { commit: true, via: "UI" });
    expect((await db.asUser(creator, async (q) => (await q("select * from public.item_activity($1, 2)", [id])).rowCount))).toBe(2);
  });
});
