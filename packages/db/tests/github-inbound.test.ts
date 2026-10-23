import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, itemA: string, connA: string, connB: string, linkA: string;
const DENIED = "42501";
const T1 = "2026-10-23T10:00:00Z", T2 = "2026-10-23T11:00:00Z", T3 = "2026-10-23T12:00:00Z";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-inbound@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await db.admin.query("delete from public.item_github_links");
  const a = await db.admin.query("select i.id as item, c.id as conn from public.items i, public.github_connections c where i.tenant_id = $1 and c.tenant_id = $1 limit 1", [f.tenantA]);
  itemA = a.rows[0].item; connA = a.rows[0].conn;
  connB = (await db.admin.query("select id from public.github_connections where tenant_id = $1", [f.tenantB])).rows[0].id;
  linkA = (await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', 31, 'https://github.com/Acme/App/issues/31', 'pending', 'follow') returning id", [f.tenantA, itemA, connA])).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

const apply = (o: { number?: number; state?: string; reason?: string | null; at?: string; id?: number; repo?: string; conn?: string } = {}) =>
  db.asService(async (q) => (await q("select public.github_apply_issue($1, $2, $3, $4, 'node31', $5, $6, $7) as r", [o.conn ?? connA, o.repo ?? "acme/app", o.number ?? 31, o.id ?? 9031, o.state ?? "open", o.reason ?? null, o.at ?? T1])).rows[0].r as { item_id: string; stale: boolean; changes: Record<string, unknown[]> } | null, { commit: true, via: "GitHub webhook" });
const item = async () => (await db.admin.query("select status, status_changed_at, last_synced_at from public.items where id = $1", [itemA])).rows[0];
const link = async () => (await db.admin.query("select * from public.item_github_links where id = $1", [linkA])).rows[0];

describe("an issue's state comes back into its item", () => {
  it("the first look at an open issue gives an item without a status Backlog, and marks the follow link synced", async () => {
    await db.admin.query("update public.items set status = null where id = $1", [itemA]);
    const r = await apply({ at: T1 });
    expect(r?.changes).toMatchObject({ status: [null, "Backlog"], gh_state: [null, "open"] });
    expect(await item()).toMatchObject({ status: "Backlog" });
    expect(await link()).toMatchObject({ gh_state: "open", sync_state: "synced", issue_id: "9031", issue_node_id: "node31" });
  });
  it("closed as completed gives Completed, closed as not planned gives Cancelled, reopened gives Not Started", async () => {
    expect((await apply({ state: "closed", reason: "completed", at: T2 }))?.changes.status).toEqual(["Backlog", "Completed"]);
    expect((await apply({ state: "closed", reason: "not_planned", at: T3 }))?.changes.status).toEqual(["Completed", "Cancelled"]);
    expect((await apply({ state: "open", at: "2026-10-23T13:00:00Z" }))?.changes.status).toEqual(["Cancelled", "Not Started"]);
  });
  it("replaying or re-sending the same state changes nothing, and older information is ignored", async () => {
    await apply({ state: "closed", reason: "completed", at: "2026-10-23T14:00:00Z" });
    const before = { item: await item(), link: await link() };
    const again = await apply({ state: "closed", reason: "completed", at: "2026-10-23T14:00:00Z" });
    expect(again?.changes).toEqual({});
    const stale = await apply({ state: "open", at: T1 });
    expect(stale?.stale).toBe(true);
    expect((await item()).status).toBe(before.item.status);
    expect((await link()).gh_state).toBe("closed_completed");
  });
  it("a human-set status is not touched by an open issue; an issue nobody links is ignored", async () => {
    await apply({ state: "open", at: "2026-10-23T15:00:00Z" });
    await db.admin.query("update public.items set status = 'In Progress' where id = $1", [itemA]);
    expect((await apply({ state: "open", at: "2026-10-23T16:00:00Z" }))?.changes).toEqual({});
    expect((await item()).status).toBe("In Progress");
    expect(await apply({ number: 999 })).toBeNull();
    expect(await apply({ repo: "other/repo" })).toBeNull();
  });
  it("a connection cannot reach another workspace's links", async () => {
    expect(await apply({ conn: connB })).toBeNull();
  });
  it("changes are audited with the source GitHub webhook and no person", async () => {
    const { rows } = await db.admin.query("select actor_id, via, new from public.audit_log where entity = 'items' and entity_id = $1 and field = 'status' and new = to_jsonb('Completed'::text) order by id desc limit 1", [itemA]);
    expect(rows[0].actor_id).toBeNull();
    expect(rows[0].via).toBe("GitHub webhook");
    const links = await db.admin.query("select distinct via from public.audit_log where entity = 'item_github_links' and entity_id = $1 and field = 'gh_state'", [linkA]);
    expect(links.rows.map((r) => r.via)).toContain("GitHub webhook");
  });
  it("signed-in users cannot call it", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.github_apply_issue($1, 'a/b', 1, 1, 'n', 'closed', 'completed', now())", [connA])))).toBe(DENIED);
  });
});

describe("the sync log", () => {
  it("only admins of the workspace read it, and nobody signed in writes it", async () => {
    await db.admin.query("insert into public.sync_events (tenant_id, connection_id, delivery_id, event, action, state) values ($1, $2, 'd-1', 'issues', 'closed', 'error')", [f.tenantA, connA]);
    expect(await db.asUser(f.alice, async (q) => (await q("select 1 from public.sync_events where delivery_id = 'd-1'")).rowCount)).toBe(1);
    for (const u of [creator, f.carol, f.bob]) expect(await db.asUser(u, async (q) => (await q("select 1 from public.sync_events where delivery_id = 'd-1'")).rowCount), u).toBe(0);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.sync_events set state = 'processed'")))).toBe(DENIED);
  });
  it("a delivery is stored once: the same delivery id again is a conflict", async () => {
    expect(await errorCode(db.admin.query("insert into public.sync_events (tenant_id, connection_id, delivery_id, event) values ($1, $2, 'd-1', 'issues')", [f.tenantA, connA]))).toBe("23505");
  });
});

describe("how long items stay in a stage", () => {
  it("lists each Status and Initiative Phase with when it started and ended, and counts open stages up to now", async () => {
    await db.admin.query("select set_config('app.via', 'UI', false)");
    await db.admin.query("update public.items set initiative_phase = 'Discover' where id = $1", [itemA]);
    await db.admin.query("update public.items set initiative_phase = 'Define' where id = $1", [itemA]);
    const rows = await db.asUser(f.alice, async (q) => (await q("select field, value, left_at, days from public.item_stage_durations($1) where item_id = $2 order by field, entered_at", [f.tenantA, itemA])).rows);
    const phases = rows.filter((r) => r.field === "initiative_phase");
    expect(phases.map((r) => r.value)).toContain("Discover");
    expect(phases.at(-1)).toMatchObject({ value: "Define", left_at: null });
    expect(Number(phases.at(-1)!.days)).toBeGreaterThanOrEqual(0);
    expect(rows.some((r) => r.field === "status" && r.value === "Completed")).toBe(true);
  });
  it("members of another workspace cannot ask", async () => {
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.item_stage_durations($1)", [f.tenantA])))).toBe(DENIED);
  });
});

describe("initiative status belongs to people; build status to the tracker", () => {
  it("a person with edit rights sets Initiative Status; nobody signed in can set Build Status", async () => {
    const own = (await db.admin.query("select id from public.items where tenant_id = $1 and deleted_at is null limit 1", [f.tenantA])).rows[0].id as string;
    await db.asUser(creator, (q) => q("update public.items set initiative_status = 'In Progress' where id = $1", [own]), { commit: true });
    expect((await db.admin.query("select initiative_status from public.items where id = $1", [own])).rows[0].initiative_status).toBe("In Progress");
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set status = 'Completed' where id = $1", [own])))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set initiative_status = 'Done-ish' where id = $1", [own]), { commit: true }))).toBe("23514");
  });
  it("a closed ticket never changes Initiative Status", async () => {
    await db.admin.query("update public.items set initiative_status = 'In Progress' where id = $1", [itemA]);
    await apply({ state: "closed", reason: "completed", at: "2026-10-24T10:00:00Z" });
    const r = (await db.admin.query("select status, initiative_status from public.items where id = $1", [itemA])).rows[0];
    expect(r).toMatchObject({ status: "Completed", initiative_status: "In Progress" });
  });
});

describe("build cycle: from the phase becoming Build to the ticket closing", () => {
  it("measures the days between the first time the phase was Build and the closing of the linked ticket", async () => {
    await db.admin.query("select set_config('app.via', 'UI', false)");
    await db.admin.query("update public.items set initiative_phase = 'Build' where id = $1", [itemA]);
    const started = (await db.admin.query("select min(at) as t from public.audit_log where entity_id = $1 and field = 'initiative_phase' and new = to_jsonb('Build'::text)", [itemA])).rows[0].t as Date;
    await db.admin.query("update public.item_github_links set gh_state = 'closed_completed', gh_closed_at = $2 where id = $1", [linkA, new Date(started.getTime() + 36 * 3600_000)]);
    const [row] = await db.asUser(f.alice, async (q) => (await q("select * from public.item_build_cycle($1) where item_id = $2", [f.tenantA, itemA])).rows);
    expect(new Date(row.build_started_at).getTime()).toBe(started.getTime());
    expect(Number(row.build_days)).toBeCloseTo(1.5, 1);
  });
  it("is empty when the build has not started or the ticket closed as not planned, and refuses other workspaces", async () => {
    await db.admin.query("update public.item_github_links set gh_state = 'closed_not_planned' where id = $1", [linkA]);
    const [row] = await db.asUser(f.alice, async (q) => (await q("select * from public.item_build_cycle($1) where item_id = $2", [f.tenantA, itemA])).rows);
    expect(row.build_completed_at).toBeNull();
    expect(row.build_days).toBeNull();
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.item_build_cycle($1)", [f.tenantA])))).toBe(DENIED);
  });
});
