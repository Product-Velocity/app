import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, type TestDb } from "./helpers";

// Issue #421: Start Building and Build Completed from the tracker's own dates. jira_apply_build_dates applies them to the linked initiative.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let connA: string;
let connB: string;
let n = 0;
const DENIED = "42501";
type Result = { key: string; item_id: string; changes: Record<string, [string | null, string | null]> }[];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-bd@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  connA = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
  connB = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantB])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

async function linked(tenant = f.tenantA, conn = connA, category = "indeterminate") {
  const key = `BD${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, `Jira ${key}`])).rows[0].id as string;
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source) values ($1, $2, 'Linked', $3) returning id", [tenant, p, `Jira issue ${key}-1`])).rows[0].id as string;
  await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode, jira_status, jira_status_category) values ($1, $2, $3, 'site-1', $4, 'follow', 'Project Execution', $5)", [tenant, item, conn, `${key}-1`, category]);
  return { item, key: `${key}-1` };
}
const apply = (conn: string, rows: unknown[], site = "site-1") => db.asService(async (q) => (await q("select public.jira_apply_build_dates($1, $2, $3::jsonb) as r", [conn, site, JSON.stringify(rows)])).rows[0].r as Result, { commit: true });
const dates = async (item: string) => (await db.admin.query("select to_char(i.start_building, 'YYYY-MM-DD') as start_building, i.initiative_phase, i.initiative_status, l.jira_resolved_at from public.items i join public.item_jira_links l on l.item_id = i.id where i.id = $1", [item])).rows[0];
const auditRows = async (item: string) => Number((await db.admin.query("select count(*) from public.audit_log where entity = 'items' and entity_id = $1 and field = 'start_building'", [item])).rows[0].count);
const cycle = (tenant: string, user: string) => db.asUser(user, async (q) => (await q("select * from public.item_build_cycle($1)", [tenant])).rows as { item_id: string; build_started_at: Date | null; build_completed_at: Date | null; build_days: string | null }[]);

describe("jira_apply_build_dates", () => {
  it("sets Start Building to the tracker's date without touching the phase or Initiative Status, and audits it as system", async () => {
    const { item, key } = await linked();
    const r = await apply(connA, [{ key, started: "2026-11-02T08:30:00Z", resolved: null }]);
    expect(r).toEqual([{ key, item_id: item, changes: { start_building: [null, "2026-11-02"] } }]);
    expect(await dates(item)).toMatchObject({ start_building: "2026-11-02", initiative_phase: null, initiative_status: null, jira_resolved_at: null });
    const a = (await db.admin.query("select via, old, new from public.audit_log where entity = 'items' and entity_id = $1 and field = 'start_building'", [item])).rows;
    expect(a).toHaveLength(1);
    expect(a[0].via).toBe("system");
  });
  it("is a no-op when the date is the same (no audit rows), and an earlier real date replaces a later noticed one", async () => {
    const { item, key } = await linked();
    await db.admin.query("update public.items set start_building = '2026-11-09' where id = $1", [item]);
    const before = await auditRows(item);
    await apply(connA, [{ key, started: "2026-11-09T01:00:00Z", resolved: null }]);
    expect(await auditRows(item)).toBe(before);
    const r = await apply(connA, [{ key, started: "2026-11-03T12:00:00Z", resolved: null }]);
    expect(r[0]!.changes).toEqual({ start_building: ["2026-11-09", "2026-11-03"] });
    expect((await dates(item)).start_building).toBe("2026-11-03");
  });
  it("no history (started null) changes nothing", async () => {
    const { item, key } = await linked();
    await apply(connA, [{ key, started: "2026-11-03T12:00:00Z", resolved: null }]);
    const r = await apply(connA, [{ key, started: null, resolved: null }]);
    expect(r[0]!.changes).toEqual({});
    expect((await dates(item)).start_building).toBe("2026-11-03");
  });
  it("stores the resolution date, clears it when the issue is reopened, and build days follow from the cycle", async () => {
    const { item, key } = await linked();
    await apply(connA, [{ key, started: "2026-11-02T08:00:00Z", resolved: null }]);
    await db.admin.query("update public.item_jira_links set jira_status_category = 'done' where item_id = $1", [item]);
    await apply(connA, [{ key, started: "2026-11-02T08:00:00Z", resolved: "2026-11-12T08:00:00Z" }]);
    expect(await cycle(f.tenantA, f.alice).then((rows) => rows.find((x) => x.item_id === item))).toMatchObject({ build_days: "10.33" });
    await db.admin.query("update public.item_jira_links set jira_status_category = 'indeterminate' where item_id = $1", [item]);
    await apply(connA, [{ key, started: "2026-11-02T08:00:00Z", resolved: null }]);
    expect((await dates(item)).jira_resolved_at).toBeNull();
    expect(await cycle(f.tenantA, f.alice).then((rows) => rows.find((x) => x.item_id === item))).toMatchObject({ build_completed_at: null, build_days: null });
  });
  it("a build that started and finished on the same day is under a day (Start Building is a date, counted from the start of that day)", async () => {
    const { item, key } = await linked();
    await db.admin.query("update public.item_jira_links set jira_status_category = 'done' where item_id = $1", [item]);
    await apply(connA, [{ key, started: "2026-11-05T20:00:00Z", resolved: "2026-11-05T09:00:00Z" }]);
    expect((await cycle(f.tenantA, f.alice)).find((x) => x.item_id === item)?.build_days).toBe("0.38");
  });
  it("stays inside the connection: another tenant's connection cannot touch the initiative, and a bad key or a trashed initiative is skipped", async () => {
    const { item, key } = await linked();
    expect(await apply(connB, [{ key, started: "2026-11-02T08:00:00Z", resolved: null }])).toEqual([]);
    expect(await apply(connA, [{ key: "nonsense", started: "2026-11-02T08:00:00Z", resolved: null }])).toEqual([]);
    expect((await dates(item)).start_building).toBeNull();
    await db.admin.query("update public.items set deleted_at = now() where id = $1", [item]);
    expect(await apply(connA, [{ key, started: "2026-11-02T08:00:00Z", resolved: null }])).toEqual([]);
  });
  it("refuses signed-in people and the anonymous role", async () => {
    const { key } = await linked();
    await expect(db.asUser(creator, (q) => q("select public.jira_apply_build_dates($1, 'site-1', $2::jsonb)", [connA, JSON.stringify([{ key, started: "2026-11-02T08:00:00Z", resolved: null }])]))).rejects.toMatchObject({ code: DENIED });
    await expect(db.asAnon((q) => q("select public.jira_apply_build_dates($1, 'site-1', '[]'::jsonb)", [connA]))).rejects.toMatchObject({ code: DENIED });
  });
  it("another tenant's member sees none of it in the build cycle", async () => {
    const { item } = await linked();
    const rows = await cycle(f.tenantB, f.bob);
    expect(rows.some((x) => x.item_id === item)).toBe(false);
  });
});
