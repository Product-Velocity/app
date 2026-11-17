import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Who moved a Jira issue to a status (issue #472): written by the service role from Jira's own history, read by the members of the workspace only.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

const rows = (user: string, tenant: string) => db.asUser(user, async (q) => (await q("select issue_key, to_status, actor_name from public.jira_status_changes where tenant_id = $1 order by issue_key", [tenant])).rows as { issue_key: string; to_status: string; actor_name: string | null }[]);

describe("jira_status_changes", () => {
  it("a member reads the changes of their own workspace and never those of another", async () => {
    await db.admin.query("insert into public.jira_status_changes (tenant_id, issue_key, changed_at, from_status, to_status, actor_name) values ($1, 'AAA-1', '2026-11-17T08:18:10Z', 'Project Closed', 'Project Execution', 'Dana Reyes')", [f.tenantA]);
    await db.admin.query("insert into public.jira_status_changes (tenant_id, issue_key, changed_at, to_status, actor_name) values ($1, 'BBB-1', '2026-11-17T08:18:10Z', 'Done', 'Someone Else')", [f.tenantB]);
    expect((await rows(f.alice, f.tenantA)).some((r) => r.issue_key === "AAA-1" && r.actor_name === "Dana Reyes")).toBe(true);
    expect((await rows(f.alice, f.tenantA)).some((r) => r.issue_key === "BBB-1")).toBe(false);
    expect((await rows(f.alice, f.tenantB)).length).toBe(0); // asking for the other workspace gives nothing
    expect((await rows(f.bob, f.tenantB)).some((r) => r.actor_name === "Someone Else")).toBe(true);
  });

  it("nobody signed in can write, change or remove a row, only the service role", async () => {
    for (const sql of [
      "insert into public.jira_status_changes (tenant_id, issue_key, changed_at, to_status, actor_name) values ($1, 'EVIL-1', now(), 'Done', 'evil')",
      "update public.jira_status_changes set actor_name = 'evil' where tenant_id = $1",
      "delete from public.jira_status_changes where tenant_id = $1",
    ]) expect(await errorCode(db.asUser(f.alice, (q) => q(sql, [f.tenantA])))).toBe(DENIED);
    expect(await errorCode(db.asAnon((q) => q("select * from public.jira_status_changes")))).toBe(DENIED);
  });

  it("is idempotent for the same change, so reading a history again adds nothing", async () => {
    const add = () => db.asService((q) => q("insert into public.jira_status_changes (tenant_id, issue_key, changed_at, to_status, actor_name) values ($1, 'DUP-1', '2026-11-17T08:00:00Z', 'Done', 'Ana') on conflict (tenant_id, issue_key, changed_at, to_status) do nothing", [f.tenantA]), { commit: true });
    await add(); await add();
    expect((await db.admin.query("select count(*)::int as n from public.jira_status_changes where issue_key = 'DUP-1'")).rows[0].n).toBe(1);
  });

  it("keeps the name short and the key well formed", async () => {
    const bad = (sql: string) => errorCode(db.admin.query(sql, [f.tenantA]));
    expect(await bad(`insert into public.jira_status_changes (tenant_id, issue_key, changed_at, to_status, actor_name) values ($1, 'AAA-9', now(), 'Done', '${"x".repeat(121)}')`)).toBe("23514");
    expect(await bad("insert into public.jira_status_changes (tenant_id, issue_key, changed_at, to_status) values ($1, 'not a key', now(), 'Done')")).toBe("23514");
  });
});
