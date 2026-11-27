import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Start Building and Build Completed for an initiative that only has epics read from Jira (issue #656 follow-up). Two tenants (rule 1).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let connA: string;
let connB: string;
let n = 0;
let seq = 7000;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

/** A read-only project with one initiative that lists the given epics (level 1 of its tree; `done` epics carry the done category). */
async function setup(epics: { done: boolean }[], opts: { tenant?: string; conn?: string; readOnly?: boolean } = {}) {
  const tenant = opts.tenant ?? f.tenantA, conn = opts.conn ?? connA;
  const i = ++n;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name, tracker) values ($1, $2, 'jira') returning id", [tenant, `EpicDates ${i}`])).rows[0].id as string;
  await db.admin.query("insert into public.jira_project_links (tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name, read_only) values ($1, $2, $3, 'site-1', $4, $5, 'Roadmap', '10010', 'Initiative', $6)", [tenant, p, conn, `4000${i}`, `ED${i}`, opts.readOnly ?? true]);
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source, status) values ($1, $2, 'Dates', 'test', 'Not started') returning id", [tenant, p])).rows[0].id as string;
  const keys: string[] = [];
  for (const e of epics) {
    const k = `ED-${++seq}`;
    keys.push(k);
    await db.admin.query("insert into public.item_jira_epic_requests (tenant_id, item_id, epic_key, state, requested_by) values ($1, $2, $3, 'pending', $4)", [tenant, item, k, f.alice]);
    await db.admin.query("insert into public.item_jira_tree (tenant_id, item_id, issue_key, parent_key, level, title, issue_type, status, status_category) values ($1, $2, $3, $3, 1, 'Epic', 'Epic', $4, $5)", [tenant, item, k, e.done ? "Done" : "In Progress", e.done ? "done" : "indeterminate"]);
  }
  return { item, keys };
}
const apply = (conn: string, item: string, started: string | null, resolved: { key: string; resolved: string | null }[], site = "site-1") =>
  db.asService(async (q) => (await q("select public.jira_apply_epic_build_dates($1, $2, $3, $4, $5::jsonb) as r", [conn, site, item, started, JSON.stringify(resolved)])).rows[0].r as { changes: Record<string, unknown> }, { commit: true });
const cycle = (who: string, tenant: string, item: string) =>
  db.asUser(who, async (q) => (await q("select * from public.item_build_cycle($1) where item_id = $2", [tenant, item])).rows[0] as { build_started_at: Date | null; build_completed_at: Date | null; build_days: string | null });
const startOf = async (item: string) => (await db.admin.query("select start_building::text as s from public.items where id = $1", [item])).rows[0].s as string | null;

describe("jira_apply_epic_build_dates", () => {
  it("sets Start Building from the history, replacing a typed date, and stores each epic's resolution; a repeat changes nothing", async () => {
    const { item, keys } = await setup([{ done: true }, { done: false }]);
    await db.admin.query("update public.items set start_building = '2026-10-01' where id = $1", [item]);
    const r = await apply(connA, item, "2026-11-02T08:00:00Z", [{ key: keys[0]!, resolved: "2026-11-12T09:00:00Z" }, { key: keys[1]!, resolved: null }]);
    expect(r.changes).toMatchObject({ start_building: ["2026-10-01", "2026-11-02"] });
    expect(await startOf(item)).toBe("2026-11-02");
    expect((await db.admin.query("select issue_key, resolved_at from public.item_jira_tree where item_id = $1 and resolved_at is not null", [item])).rows.map((x) => x.issue_key)).toEqual([keys[0]]);
    expect((await apply(connA, item, "2026-11-02T20:00:00Z", [{ key: keys[0]!, resolved: "2026-11-12T09:00:00Z" }])).changes).toEqual({});
    const audit = (await db.admin.query("select count(*)::int n from public.audit_log where entity = 'items' and entity_id = $1 and field = 'start_building' and via = 'system' and new = to_jsonb('2026-11-02'::text)", [item])).rows[0].n as number;
    expect(audit).toBe(1);
  });

  it("a null started changes nothing, and Phase and Status are never touched", async () => {
    const { item, keys } = await setup([{ done: true }]);
    await db.admin.query("update public.items set start_building = '2026-10-05', initiative_phase = 'Define' where id = $1", [item]);
    await apply(connA, item, null, [{ key: keys[0]!, resolved: "2026-11-12T09:00:00Z" }]);
    const row = (await db.admin.query("select start_building::text as s, initiative_phase, status from public.items where id = $1", [item])).rows[0];
    expect(row).toEqual({ s: "2026-10-05", initiative_phase: "Define", status: "Not started" });
  });

  it("only service role, only for a read-only project of this connection and site with epics listed", async () => {
    const { item } = await setup([{ done: false }]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_apply_epic_build_dates($1, 'site-1', $2, null, '[]'::jsonb)", [connA, item])))).toBe(DENIED);
    expect(await errorCode(apply(connB, item, null, []))).toBe("22023"); // another connection
    expect(await errorCode(apply(connA, item, null, [], "other-site"))).toBe("22023");
    const writable = await setup([{ done: false }], { readOnly: false });
    expect(await errorCode(apply(connA, writable.item, null, []))).toBe("22023"); // a project that can write has its own path
    const noEpics = await setup([]);
    expect(await errorCode(apply(connA, noEpics.item, null, []))).toBe("22023");
    const other = await setup([{ done: false }], { tenant: f.tenantB, conn: connB });
    expect(await errorCode(apply(connA, other.item, null, []))).toBe("22023"); // another workspace's initiative
  });
});

describe("Build Completed from the epics", () => {
  it("is the latest epic resolution once every listed epic is done, and empty while one is not", async () => {
    const { item, keys } = await setup([{ done: true }, { done: true }]);
    await apply(connA, item, "2026-11-02T08:00:00Z", [{ key: keys[0]!, resolved: "2026-11-10T09:00:00Z" }, { key: keys[1]!, resolved: "2026-11-12T09:00:00Z" }]);
    const c = await cycle(f.alice, f.tenantA, item);
    expect(c.build_completed_at?.toISOString()).toBe("2026-11-12T09:00:00.000Z");
    expect(c.build_started_at?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(Number(c.build_days)).toBeGreaterThan(10);
    // the same number reaches the Building Time of the computed view
    expect((await db.admin.query("select time_building_days from public.items_computed where id = $1", [item])).rows[0].time_building_days).toBe(10);

    await db.admin.query("update public.item_jira_tree set status_category = 'indeterminate', status = 'In Progress' where item_id = $1 and issue_key = $2", [item, keys[1]]);
    expect((await cycle(f.alice, f.tenantA, item)).build_completed_at).toBeNull();
  });

  it("an epic that is done without a resolution date, or no epics at all, gives no end", async () => {
    const { item } = await setup([{ done: true }]);
    expect((await cycle(f.alice, f.tenantA, item)).build_completed_at).toBeNull();
  });

  it("another workspace cannot read it", async () => {
    const { item } = await setup([{ done: true }]);
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.item_build_cycle($1)", [f.tenantA])))).toBe(DENIED);
    const seen = await db.asUser(f.bob, async (q) => (await q("select public.epics_build_end($1, $2) as d", [f.tenantA, item])).rows[0].d);
    expect(seen).toBeNull();
  });
});

describe("item_build_cycle: the tracker's start wins, Product Velocity's move to Build is the fallback (issue 735)", () => {
  const startedDay = async (item: string) => (await cycle(f.alice, f.tenantA, item))?.build_started_at?.toISOString().slice(0, 10) ?? null;
  it("uses Start Building (the Jira-derived date) even when the initiative moved to Build later in Product Velocity", async () => {
    const { item } = await setup([{ done: true }]);
    await db.admin.query("update public.items set initiative_phase = 'Build' where id = $1", [item]); // the move to Build is audited now and fills Start Building with today
    await db.admin.query("update public.items set start_building = '2026-11-10' where id = $1", [item]); // what the Jira sync then writes
    expect(await startedDay(item)).toBe("2026-11-10");
  });
  it("falls back to the first move to Build when Start Building is empty", async () => {
    const { item } = await setup([{ done: true }]);
    await db.admin.query("update public.items set initiative_phase = 'Build' where id = $1", [item]);
    await db.admin.query("update public.items set start_building = null where id = $1", [item]);
    const moved = (await db.admin.query("select min(at)::date::text as d from public.audit_log where entity = 'items' and entity_id = $1 and field = 'initiative_phase' and new = to_jsonb('Build'::text)", [item])).rows[0].d as string | null;
    expect(moved).not.toBeNull();
    expect(await startedDay(item)).toBe(moved);
  });
  it("a tenant cannot read another tenant's cycle (rule 1)", async () => {
    expect(await errorCode(db.asUser(f.bob, (q) => q("select * from public.item_build_cycle($1)", [f.tenantA])))).toBe(DENIED);
  });
});
