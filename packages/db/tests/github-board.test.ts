import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string, itemA: string, connA: string;
const DENIED = "42501";
const CHECK = "23514";
const board = { id: "PVT_abc", number: 3, title: "Product Velocity roadmap", url: "https://github.com/orgs/Acme/projects/3", mapping: { priority: { id: "F1", name: "Priority" } } };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "board-creator@example.test");
  viewer = await createUser(db, "board-viewer@example.test");
  service = await createUser(db, "board-service@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  const a = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantA]);
  [itemA, connA] = [a.rows[0].item, a.rows[0].conn];
  await db.asService((q) => q("select public.github_record_push($1, $2, $3, 'acme/roadmap', 7, 4007, 'node', 'https://github.com/acme/roadmap/issues/7', 'h1', 'synced', null)", [creator, itemA, connA]), { commit: true, via: "UI" });
});
afterAll(async () => { await db.close(); });

describe("projects.github_board", () => {
  it("an admin links a board; it is audited with actor and source", async () => {
    await db.asUser(f.alice, (q) => q("update public.projects set github_board = $2 where id = $1", [f.seedA.project, JSON.stringify(board)]), { commit: true, via: "UI" });
    expect((await db.admin.query("select github_board->>'title' as t from public.projects where id = $1", [f.seedA.project])).rows[0].t).toBe("Product Velocity roadmap");
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'projects' and entity_id = $1 and field = 'github_board' order by id desc limit 1", [f.seedA.project])).rows[0];
    expect(a).toMatchObject({ actor_id: f.alice, via: "UI" });
  });
  it("must be a JSON object of sane size", async () => {
    for (const bad of ['"text"', "[1]", JSON.stringify({ pad: "x".repeat(20001) })]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q("update public.projects set github_board = $2::jsonb where id = $1", [f.seedA.project, bad]), { via: "UI" }))).toBe(CHECK);
    }
  });
  it("non-admins cannot link a board, and another workspace cannot touch it", async () => {
    expect(await db.asUser(creator, async (q) => (await q("update public.projects set github_board = null where id = $1", [f.seedA.project])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(viewer, async (q) => (await q("update public.projects set github_board = null where id = $1", [f.seedA.project])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("update public.projects set github_board = null where id = $1", [f.seedA.project])).rowCount, { commit: true })).toBe(0);
    expect(await db.asUser(f.bob, async (q) => (await q("select github_board from public.projects where id = $1", [f.seedA.project])).rowCount)).toBe(0);
    expect((await db.admin.query("select github_board is not null as linked from public.projects where id = $1", [f.seedA.project])).rows[0].linked).toBe(true);
  });
});

describe("item_github_links.project_item_id", () => {
  const record = (actor: string, item = itemA, id = "PVTI_1") => db.asService((q) => q("select public.github_record_project_item($1, $2, $3)", [actor, item, id]), { commit: true, via: "UI" });
  it("the server records the board item for a push confirmed by a creator, audited", async () => {
    await record(creator);
    expect((await db.admin.query("select project_item_id from public.item_github_links where item_id = $1", [itemA])).rows[0].project_item_id).toBe("PVTI_1");
    const a = (await db.admin.query("select actor_id from public.audit_log where entity = 'item_github_links' and field = 'project_item_id' order by id desc limit 1")).rows[0];
    expect(a.actor_id).toBe(creator);
  });
  it("viewers and service accounts cannot be the actor, and signed-in users cannot call it at all", async () => {
    expect(await errorCode(record(viewer, itemA, "PVTI_x"))).toBe(DENIED);
    expect(await errorCode(record(service, itemA, "PVTI_x"))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("select public.github_record_project_item($1, $2, 'PVTI_x')", [creator, itemA])))).toBe(DENIED);
    expect((await db.admin.query("select project_item_id from public.item_github_links where item_id = $1", [itemA])).rows[0].project_item_id).toBe("PVTI_1");
  });
  it("a creator of another workspace cannot record an item of this one", async () => {
    expect(await errorCode(record(f.bob))).toBe(DENIED);
  });
});
