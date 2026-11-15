import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Epic keys at creation (issue #431): the request table and its three functions.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let viewer: string;
let connA: string;
let n = 0;
let seq = 1000;
/** A key nobody asked for yet: one epic belongs to one initiative, and the tests share a database. */
const fresh = (c = 1) => Array.from({ length: c }, () => `R8P-${++seq}`);
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-er@example.test");
  viewer = await createUser(db, "viewer-er@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

/** An initiative of a project that is linked to its own Jira project (key EPn), optionally already linked to a Jira issue. */
async function initiative(opts: { link?: "push" | "follow"; linked?: boolean; tenant?: string; conn?: string } = {}) {
  const tenant = opts.tenant ?? f.tenantA;
  const conn = opts.conn ?? connA;
  const i = ++n;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, `Epics ${i}`])).rows[0].id as string;
  if (opts.linked !== false) {
    await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, 'site-1', $4, $5, 'Roadmap', '10010', 'Initiative')", [tenant, p, conn, `2000${i}`, `EP${i}`]);
  }
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source) values ($1, $2, 'Wants epics', 'test') returning id", [tenant, p])).rows[0].id as string;
  if (opts.link) await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode) values ($1, $2, $3, 'site-1', $4, $5)", [tenant, item, conn, `EP${i}-1`, opts.link]);
  return { item, project: p };
}
const request = (who: string, item: string, keys: string[]) => db.asUser(who, async (q) => (await q("select public.item_request_jira_epics($1, $2::text[]) as r", [item, keys])).rows[0].r as string[], { commit: true });
const remove = (who: string, item: string, key: string) => db.asUser(who, async (q) => (await q("select public.item_remove_jira_epic_request($1, $2) as r", [item, key])).rows[0].r as boolean, { commit: true });
const record = (actor: string, item: string, key: string, ok: boolean, previous: string | null, error: string | null) =>
  db.asService((q) => q("select public.jira_record_epic_link($1, $2, $3, $4, $5, $6)", [actor, item, key, ok, previous, error]), { commit: true });
const rows = async (item: string) => (await db.admin.query("select epic_key, state, previous_parent, last_error, requested_by from public.item_jira_epic_requests where item_id = $1 order by epic_key", [item])).rows;

describe("item_request_jira_epics", () => {
  it("records the keys as pending, for the person, and returns the new ones", async () => {
    const { item } = await initiative();
    const [a, b] = fresh(2);
    expect(await request(f.alice, item, [a!, b!])).toEqual([a, b]);
    expect(await rows(item)).toEqual([a, b].sort().map((k) => ({ epic_key: k, state: "pending", previous_parent: null, last_error: null, requested_by: f.alice })));
  });
  it("asking again for a key already asked for adds nothing; a failed one is asked for again", async () => {
    const { item } = await initiative();
    const [a, b] = fresh(2);
    await request(f.alice, item, [a!]);
    expect(await request(f.alice, item, [a!, b!])).toEqual([b]);
    await record(f.alice, item, a!, false, null, "Jira refused it.");
    expect((await rows(item)).find((r) => r.epic_key === a)).toMatchObject({ state: "failed", last_error: "Jira refused it." });
    expect(await request(f.alice, item, [a!])).toEqual([a]);
    expect((await rows(item)).find((r) => r.epic_key === a)).toMatchObject({ state: "pending", last_error: null });
  });
  it("works for an initiative that is already linked to its own Jira issue (push), not for a read-only one", async () => {
    const [a, b] = fresh(2);
    const owned = await initiative({ link: "push" });
    expect(await request(f.alice, owned.item, [a!])).toEqual([a]);
    const followed = await initiative({ link: "follow" });
    expect(await errorCode(request(f.alice, followed.item, [b!]))).toBe("22023");
  });
  it("needs a project that is linked to a Jira project", async () => {
    const { item } = await initiative({ linked: false });
    expect(await errorCode(request(f.alice, item, fresh()))).toBe("22023");
  });
  it("one epic belongs to one initiative: another one wanting it, or an initiative's own Jira issue, is refused", async () => {
    const [a] = fresh();
    const x = await initiative();
    const y = await initiative();
    await request(f.alice, x.item, [a!]);
    expect(await errorCode(request(f.alice, y.item, [a!]))).toBe("23505");
    const own = await initiative({ link: "push" });
    const key = (await db.admin.query("select issue_key from public.item_jira_links where item_id = $1", [own.item])).rows[0].issue_key as string;
    expect(await errorCode(request(f.alice, x.item, [key]))).toBe("23505");
    // once a request failed it no longer holds the key
    await record(f.alice, x.item, a!, false, null, "x");
    expect(await request(f.alice, y.item, [a!])).toEqual([a]);
  });
  it("refuses bad keys, none, and more than 50", async () => {
    const { item } = await initiative();
    expect(await errorCode(request(f.alice, item, ["not a key"]))).toBe("22023");
    expect(await errorCode(request(f.alice, item, []))).toBe("22023");
    expect(await errorCode(request(f.alice, item, fresh(51)))).toBe("22023");
    expect(await rows(item)).toEqual([]);
  });
  it("creators and admins may, viewers and other workspaces may not", async () => {
    const { item } = await initiative();
    const [a, b, c] = fresh(3);
    expect(await request(creator, item, [a!])).toEqual([a]);
    expect(await errorCode(request(viewer, item, [b!]))).toBe(DENIED);
    expect(await errorCode(request(f.bob, item, [c!]))).toBe(DENIED);
  });
  it("is audited as the person, with source UI", async () => {
    const { item } = await initiative();
    await request(f.alice, item, fresh());
    const a = (await db.admin.query("select actor_id, via, entity from public.audit_log where entity = 'item_jira_epic_requests' and entity_id = (select id from public.item_jira_epic_requests where item_id = $1) order by at limit 1", [item])).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: f.alice, via: "UI" });
  });
});

describe("item_remove_jira_epic_request", () => {
  it("removes a pending or failed request, never a linked one", async () => {
    const { item } = await initiative();
    const [a, b, c] = fresh(3);
    await request(f.alice, item, [a!, b!, c!]);
    await record(f.alice, item, b!, true, "QQ-1", null);
    await record(f.alice, item, c!, false, null, "x");
    expect(await remove(f.alice, item, a!)).toBe(true);
    expect(await remove(f.alice, item, c!)).toBe(true);
    expect(await remove(f.alice, item, b!)).toBe(false);
    expect((await rows(item)).map((r) => r.epic_key)).toEqual([b]);
  });
  it("is for people who may edit the initiative", async () => {
    const { item } = await initiative();
    const [a] = fresh();
    await request(f.alice, item, [a!]);
    expect(await errorCode(remove(viewer, item, a!))).toBe(DENIED);
    expect(await errorCode(remove(f.bob, item, a!))).toBe(DENIED);
  });
});

describe("jira_record_epic_link", () => {
  it("records a linked epic with the parent it had, and a failed one with the reason", async () => {
    const { item } = await initiative();
    const [a, b] = fresh(2);
    await request(f.alice, item, [a!, b!]);
    await record(f.alice, item, a!, true, "QQ-4", null);
    await record(f.alice, item, b!, false, null, "x".repeat(400));
    const r = await rows(item);
    const ra = r.find((x) => x.epic_key === a)!, rb = r.find((x) => x.epic_key === b)!;
    expect(ra).toMatchObject({ state: "linked", previous_parent: "QQ-4", last_error: null });
    expect(rb).toMatchObject({ state: "failed" });
    expect((rb.last_error as string).length).toBe(300);
    expect((await db.admin.query("select linked_at is not null as l from public.item_jira_epic_requests where item_id = $1 and epic_key = $2", [item, a])).rows[0].l).toBe(true);
  });
  it("is audited as the person who confirmed the sync", async () => {
    const { item } = await initiative();
    const [a] = fresh();
    await request(f.alice, item, [a!]);
    await record(creator, item, a!, true, null, null);
    const au = (await db.admin.query("select actor_id, field, old, new from public.audit_log where entity = 'item_jira_epic_requests' and field = 'state' and new = to_jsonb('linked'::text) and entity_id = (select id from public.item_jira_epic_requests where item_id = $1)", [item])).rows;
    expect(au).toEqual([{ actor_id: creator, field: "state", old: "pending", new: "linked" }]);
  });
  it("refuses a person who may not sync, and cannot be called by signed-in people", async () => {
    const { item } = await initiative();
    const [a] = fresh();
    await request(f.alice, item, [a!]);
    expect(await errorCode(record(viewer, item, a!, true, null, null))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_record_epic_link($1, $2, $3, true, null, null)", [f.alice, item, a]), { commit: true }))).toBe(DENIED);
    expect((await rows(item))[0].state).toBe("pending");
  });
});

describe("who can read the table", () => {
  it("members of the workspace read its requests; another workspace sees none", async () => {
    const { item } = await initiative();
    await request(f.alice, item, fresh());
    const read = (who: string) => db.asUser(who, async (q) => (await q("select count(*)::int as n from public.item_jira_epic_requests where item_id = $1", [item])).rows[0].n as number);
    expect(await read(viewer)).toBe(1);
    expect(await read(f.bob)).toBe(0);
  });
});
