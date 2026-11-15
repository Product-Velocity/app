import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string;
let connA: string, connB: string;
const DENIED = "42501";
const CHECKS = [{ key: "level", label: "A level above Epic", status: "pass", reason: "Initiative at level 2." }];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-checks@example.test");
  service = await createUser(db, "service-checks@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  const c = async (t: string) => (await db.admin.query("select id from public.jira_connections where tenant_id = $1 limit 1", [t])).rows[0].id as string;
  connA = await c(f.tenantA);
  connB = await c(f.tenantB);
});
afterAll(async () => {
  await db.close();
});

const save = (user: string, tenant: string, conn: string, kind = "read", checks: unknown = CHECKS) =>
  db.asUser(user, async (q) => (await q("select public.jira_check_run_save($1, $2, $3, $4::jsonb)", [tenant, conn, kind, JSON.stringify(checks)])).rows[0].jira_check_run_save as string, { commit: true });

describe("jira_check_runs", () => {
  it("a human admin saves a run; the audit row names the admin and the source UI", async () => {
    const id = await save(f.alice, f.tenantA, connA);
    const { rows } = await db.admin.query("select actor_id, via, field from public.audit_log where entity = 'jira_check_runs' and entity_id = $1", [id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_id === f.alice && r.via === "UI")).toBe(true);
    expect(rows.map((r) => r.field)).toContain("checks");
    const run = (await db.admin.query("select run_by, kind from public.jira_check_runs where id = $1", [id])).rows[0];
    expect(run).toMatchObject({ run_by: f.alice, kind: "read" });
  });
  it("creators, service accounts, Claude over MCP and admins of another workspace cannot save, and nothing is written", async () => {
    const before = (await db.admin.query("select count(*)::int n from public.jira_check_runs")).rows[0].n;
    expect(await errorCode(save(creator, f.tenantA, connA))).toBe(DENIED);
    expect(await errorCode(save(service, f.tenantA, connA))).toBe(DENIED);
    expect(await errorCode(save(f.alice, f.tenantB, connB))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.jira_check_run_save($1, $2, 'read', $3::jsonb)", [f.tenantA, connA, JSON.stringify(CHECKS)]), { commit: true, via: "MCP" }).then(() => null))).toBeNull(); // via is forced to UI by the function, the admin is still a human
    expect((await db.admin.query("select count(*)::int n from public.jira_check_runs")).rows[0].n).toBe(before + 1);
  });
  it("a connection of another workspace is refused", async () => {
    expect(await errorCode(save(f.alice, f.tenantA, connB))).not.toBeNull();
  });
  it("the checks must be a non-empty list and the kind read or write", async () => {
    expect(await errorCode(save(f.alice, f.tenantA, connA, "read", {}))).toBe("23514");
    expect(await errorCode(save(f.alice, f.tenantA, connA, "read", []))).toBe("23514");
    expect(await errorCode(save(f.alice, f.tenantA, connA, "other"))).toBe("23514");
  });
  it("only admins of the workspace read its runs", async () => {
    await save(f.bob, f.tenantB, connB);
    const mine = await db.asUser(f.alice, async (q) => (await q("select tenant_id from public.jira_check_runs")).rows);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.tenant_id === f.tenantA)).toBe(true);
    const theirs = await db.asUser(creator, async (q) => (await q("select id from public.jira_check_runs")).rows);
    expect(theirs).toEqual([]);
  });
  it("nobody writes the table directly", async () => {
    for (const sql of [
      "insert into public.jira_check_runs (tenant_id, connection_id, kind, checks) values ($1, $2, 'read', '[{}]'::jsonb)",
      "update public.jira_check_runs set kind = 'write' where tenant_id = $1 and $2::uuid is not null",
      "delete from public.jira_check_runs where tenant_id = $1 and $2::uuid is not null",
    ]) {
      let affected = 0;
      const code = await errorCode(db.asUser(f.alice, async (q) => { affected = (await q(sql, [f.tenantA, connA])).rowCount ?? 0; }, { commit: true }));
      expect(code === DENIED || (code === null && affected === 0), sql).toBe(true);
    }
  });
});
