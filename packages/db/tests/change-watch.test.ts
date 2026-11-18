import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Change bell: change_counts() counts the Changes-report kinds of change per account, project and type since the person last cleared them.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let editor: string, watcher: string, outsider: string;
const DENIED = "42501";
type Row = { tenant_id: string; tenant_name: string; project_id: string; project_name: string; change_type: string; n: number };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  editor = await createUser(db, "editor-cw@example.test");
  watcher = await createUser(db, "watcher-cw@example.test"); // a member of BOTH accounts
  outsider = await createUser(db, "outsider-cw@example.test"); // a member of neither
  await addMember(db, f.alice, f.tenantA, editor, "creator");
  await addMember(db, f.alice, f.tenantA, watcher, "viewer");
  await addMember(db, f.bob, f.tenantB, watcher, "viewer");
});
afterAll(async () => {
  await db.close();
});

const counts = (user: string) => db.asUser(user, async (q) => (await q("select * from public.change_counts()")).rows as Row[], { commit: true });
const clear = (user: string, ...args: (string | null)[]) => db.asUser(user, async (q) => (await q("select public.clear_change_counts($1, $2) as n", [args[0] ?? null, args[1] ?? null])).rows[0].n as number, { commit: true });
const newItem = async (tenant: string, project: string) => (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Watch test', $2) returning id", [tenant, project])).rows[0].id as string;
const change = async (tenant: string, sql: string, params: unknown[], user = editor) => db.asUser(user, (q) => q(sql, params), { commit: true, via: "UI" });
const total = (rows: Row[], project: string) => rows.filter((r) => r.project_id === project).reduce((s, r) => s + r.n, 0);

describe("change_counts", () => {
  it("starts a project at zero, then counts others' changes per type across every account of the person", async () => {
    await counts(watcher); // first sight: baselines at now
    const a = await newItem(f.tenantA, f.seedA.project);
    const b = await newItem(f.tenantB, f.seedB.project);
    await db.admin.query("select pg_sleep(0.05)");
    await change(f.tenantA, "update public.items set health = 'At Risk' where id = $1", [a]);
    await change(f.tenantA, "update public.items set health = 'Delayed', effort = 'M', moscow = 'Must' where id = $1", [a]);
    await db.admin.query("update public.items set health = 'Blocked' where id = $1", [b]);
    const rows = await counts(watcher);
    const pa = rows.filter((r) => r.project_id === f.seedA.project);
    expect(pa.find((r) => r.change_type === "health")?.n).toBe(2);
    expect(pa.map((r) => r.change_type)).not.toContain("effort"); // commercial and other fields never counted
    expect(pa[0]).toMatchObject({ tenant_id: f.tenantA, tenant_name: "Tenant A" });
    expect(total(rows, f.seedB.project)).toBe(1);
    expect(rows.find((r) => r.project_id === f.seedB.project)).toMatchObject({ tenant_id: f.tenantB, tenant_name: "Tenant B" });
  });

  it("does not count the person's own changes", async () => {
    await counts(editor);
    const a = await newItem(f.tenantA, f.seedA.project);
    await db.admin.query("select pg_sleep(0.05)");
    await change(f.tenantA, "update public.items set health = 'At Risk' where id = $1", [a]);
    expect(total(await counts(editor), f.seedA.project)).toBe(0);
    expect(total(await counts(watcher), f.seedA.project)).toBeGreaterThan(0);
  });

  it("clears one project, one account or everything, and counts again from then on", async () => {
    const a = await newItem(f.tenantA, f.seedA.project);
    const b = await newItem(f.tenantB, f.seedB.project);
    await db.admin.query("select pg_sleep(0.05)");
    await change(f.tenantA, "update public.items set health = 'At Risk' where id = $1", [a]);
    await db.admin.query("update public.items set health = 'Blocked' where id = $1", [b]);
    expect(await clear(watcher, f.tenantA, f.seedA.project)).toBe(1);
    let rows = await counts(watcher);
    expect(total(rows, f.seedA.project)).toBe(0);
    expect(total(rows, f.seedB.project)).toBeGreaterThan(0);
    await clear(watcher);
    expect(await counts(watcher)).toHaveLength(0);
    await db.admin.query("select pg_sleep(0.05)");
    await change(f.tenantA, "update public.items set health = 'Delayed' where id = $1", [a]);
    rows = await counts(watcher);
    expect(total(rows, f.seedA.project)).toBe(1);
  });

  it("never shows or clears another account's projects, and refuses anonymous callers", async () => {
    expect(await counts(outsider)).toHaveLength(0);
    expect(await clear(outsider)).toBe(0);
    const bobRows = await counts(f.bob);
    expect(bobRows.every((r) => r.tenant_id === f.tenantB)).toBe(true);
    expect(await errorCode(db.asAnon((q) => q("select * from public.change_counts()")))).toBe(DENIED);
  });

  it("keeps a person's marks private and read-only through the table", async () => {
    const own = await db.asUser(watcher, async (q) => (await q("select user_id from public.change_watch_clears")).rows as { user_id: string }[]);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.user_id === watcher)).toBe(true);
    expect(await errorCode(db.asUser(watcher, (q) => q("update public.change_watch_clears set cleared_at = now()")))).toBeTruthy();
  });
});
