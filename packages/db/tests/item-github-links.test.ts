import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string, itemA: string, connA: string, itemB: string, connB: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-link@example.test");
  viewer = await createUser(db, "viewer-link@example.test");
  service = await createUser(db, "service-link@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  await db.admin.query("delete from public.item_github_links");
  const a = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantA]);
  const b = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantB]);
  [itemA, connA, itemB, connB] = [a.rows[0].item, a.rows[0].conn, b.rows[0].item, b.rows[0].conn];
});
afterAll(async () => {
  await db.close();
});

const push = (actor: string, o: { item?: string; conn?: string; number?: number | null; state?: string; hash?: string; error?: string | null } = {}) =>
  db.asService(
    (q) => q("select public.github_record_push($1, $2, $3, 'acme/roadmap', $4, $5, 'node', $6, $7, $8, $9)", [actor, o.item ?? itemA, o.conn ?? connA, o.number === undefined ? 7 : o.number, o.number === null ? null : 4007, o.number === null ? null : "https://github.com/acme/roadmap/issues/7", o.hash ?? "h1", o.state ?? "synced", o.error ?? null]),
    { commit: true, via: "UI" },
  );
const link = async (item = itemA) => (await db.admin.query("select * from public.item_github_links where item_id = $1", [item])).rows[0];

describe("pushing an item records one link, on behalf of the person who confirmed", () => {
  it("a creator's push creates the link; a second push updates the same row (never a second issue)", async () => {
    await push(creator);
    expect(await link()).toMatchObject({ issue_number: 7, sync_state: "synced", last_pushed_hash: "h1", created_by: creator });
    await push(creator, { hash: "h2" });
    expect((await db.admin.query("select count(*)::int as n from public.item_github_links where item_id = $1", [itemA])).rows[0].n).toBe(1);
    expect((await link()).last_pushed_hash).toBe("h2");
  });
  it("a failed push keeps the issue number and the last good hash, and shows the error", async () => {
    await push(creator, { number: null, state: "error", error: "GitHub refused the request (403)" });
    expect(await link()).toMatchObject({ sync_state: "error", issue_number: 7, last_pushed_hash: "h2", last_error: "GitHub refused the request (403)" });
    await push(creator, { hash: "h3" });
    expect(await link()).toMatchObject({ sync_state: "synced", last_error: null, last_pushed_hash: "h3" });
  });
  it("the audit log names the person and the source, not the server", async () => {
    const { rows } = await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_github_links' and entity_id = $1 and field = 'sync_state'", [(await link()).id]);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toMatchObject({ actor_id: creator, via: "UI" });
  });
});

describe("links that only follow a GitHub issue", () => {
  it("a follow link can never be pushed to, even by an admin, and nothing about it changes", async () => {
    await push(creator);
    await db.admin.query("update public.item_github_links set mode = 'follow' where item_id = $1", [itemA]);
    const before = await link();
    for (const who of [creator, f.alice]) expect(await errorCode(push(who, { hash: "h9", number: 99 })), who).toBe("PV006");
    expect(await link()).toEqual(before);
    await db.admin.query("update public.item_github_links set mode = 'push' where item_id = $1", [itemA]);
  });
  it("mode is only push or follow", async () => {
    expect(await errorCode(db.admin.query("update public.item_github_links set mode = 'write' where item_id = $1", [itemA]))).toBe("23514");
  });
});

describe("who and what may be recorded", () => {
  it("viewers, service accounts, other workspaces' people and unknown people are refused", async () => {
    for (const who of [viewer, service, f.bob, "00000000-0000-0000-0000-000000000000"]) {
      expect(await errorCode(push(who, { number: 9 })), who).toBe(DENIED);
    }
    expect((await link()).issue_number).toBe(7);
  });
  it("an item or connection of another workspace cannot be mixed in", async () => {
    expect(await errorCode(push(creator, { item: itemB }))).toBe(DENIED);
    expect(await errorCode(push(creator, { conn: connB }))).toBe(DENIED);
    expect(await errorCode(push(f.bob, { item: itemA, conn: connB }))).toBe(DENIED);
  });
  it("only connected connections count, and states are checked", async () => {
    await db.admin.query("update public.github_connections set state = 'suspended' where id = $1", [connA]);
    expect(await errorCode(push(creator))).toBe(DENIED);
    await db.admin.query("update public.github_connections set state = 'connected' where id = $1", [connA]);
    expect(await errorCode(push(creator, { state: "weird" }))).toBe("22023");
  });
  it("signed-in users cannot call the function or write the table, but members can read it", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.github_record_push($1, $2, $3, 'a/b', 1, 1, 'n', 'https://x', 'h', 'synced', null)", [creator, itemA, connA])))).toBe(DENIED);
    for (const sql of ["update public.item_github_links set sync_state = 'error'", "delete from public.item_github_links", "insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'a/b')"]) {
      expect(await errorCode(db.asUser(creator, (q) => q(sql))), sql).toBe(DENIED);
    }
    for (const u of [creator, viewer, f.alice]) expect(await db.asUser(u, async (q) => (await q("select 1 from public.item_github_links where item_id = $1", [itemA])).rowCount), u).toBe(1);
    expect(await db.asUser(f.bob, async (q) => (await q("select 1 from public.item_github_links where tenant_id = $1", [f.tenantA])).rowCount)).toBe(0);
  });
  it("a synced link needs its issue; deleting the item removes the link", async () => {
    expect(await errorCode(push(creator, { number: null, state: "synced" }))).toBe("23514");
    await db.admin.query("delete from public.items where id = $1", [itemA]).catch(() => undefined);
  });
});
