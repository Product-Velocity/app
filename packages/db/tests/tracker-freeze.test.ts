import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Finished initiatives stop syncing (issue #323, docs/28-DECISION-GATES.md section 9).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, approver: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "freeze-creator@example.test");
  approver = await createUser(db, "freeze-approver@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, approver, "creator");
  await db.admin.query("update public.tenant_members set is_approver = true where tenant_id = $1 and user_id = $2", [f.tenantA, approver]);
});
afterAll(async () => { await db.close(); });

const ghItem = () => f.seedA.items[0]!; // has a GitHub link (seedWorkspace)
const jiraItem = () => f.seedA.items[1]!; // has a Jira link
const frozen = async (table: string, item: string) => (await db.admin.query(`select frozen_at, sync_resumed_at from public.${table} where item_id = $1`, [item])).rows[0];
const setStatus = (user: string, item: string, status: string) => db.asUser(user, (q) => q("update public.items set initiative_status = $2 where id = $1", [item, status]), { commit: true, via: "UI" });
const freeze = (days: number) => db.asService(async (q) => (await q("select public.freeze_finished_links($1) as r", [days])).rows[0].r as { github: number; jira: number }, { commit: true });

describe("freezing finished initiatives", () => {
  it("does not touch an active initiative or one that finished less than the grace period ago", async () => {
    expect(await freeze(14)).toEqual({ github: 0, jira: 0 });
    await setStatus(creator, ghItem(), "Completed");
    expect(await freeze(14)).toEqual({ github: 0, jira: 0 }); // just completed: the grace period has not passed
    expect((await frozen("item_github_links", ghItem())).frozen_at).toBeNull();
  });

  it("freezes both trackers' links once the grace period has passed, for Completed and Cancelled, and audits it", async () => {
    await setStatus(creator, jiraItem(), "Cancelled");
    expect(await freeze(0)).toEqual({ github: 1, jira: 1 });
    expect((await frozen("item_github_links", ghItem())).frozen_at).not.toBeNull();
    expect((await frozen("item_jira_links", jiraItem())).frozen_at).not.toBeNull();
    const a = (await db.admin.query("select field, via from public.audit_log where entity = 'item_github_links' and field = 'frozen_at' order by id desc limit 1")).rows[0];
    expect(a).toMatchObject({ field: "frozen_at" });
    expect(await freeze(0)).toEqual({ github: 0, jira: 0 }); // already frozen
  });

  it("moving the status back unfreezes by itself", async () => {
    await setStatus(creator, ghItem(), "Active");
    expect((await frozen("item_github_links", ghItem())).frozen_at).toBeNull();
    expect((await frozen("item_jira_links", jiraItem())).frozen_at).not.toBeNull(); // the other one stays frozen
  });

  it("only an Admin or an Approver resumes, and a resumed link gets a fresh grace period", async () => {
    expect(await errorCode(db.asUser(creator, (q) => q("select public.resume_sync($1)", [jiraItem()]), { commit: true, via: "UI" }))).toBe(DENIED);
    expect(await errorCode(db.asUser(approver, (q) => q("select public.resume_sync($1)", [jiraItem()]), { commit: true, via: "MCP" }))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.resume_sync($1)", [jiraItem()]), { commit: true, via: "UI" }))).toBe(DENIED); // an admin of the other workspace
    const r = await db.asUser(approver, async (q) => (await q("select public.resume_sync($1) as r", [jiraItem()])).rows[0].r, { commit: true, via: "UI" });
    expect(r).toEqual({ github: 0, jira: 1 });
    const row = await frozen("item_jira_links", jiraItem());
    expect(row.frozen_at).toBeNull();
    expect(row.sync_resumed_at).not.toBeNull();
    expect(await freeze(14)).toEqual({ github: 0, jira: 0 }); // resumed less than 14 days ago: not frozen again yet
  });

  it("is not callable by people: only the daily job freezes", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.freeze_finished_links(0)"), { commit: true }))).toBe(DENIED);
  });
});
