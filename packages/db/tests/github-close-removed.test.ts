import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// GitHub: label and close the issue of a removed initiative (decision 2026-11-03-github-close-removed). github_record_removed only REMEMBERS that it
// was handled; the GitHub calls are made by the app (tested against a fake GitHub). Two tenants: another workspace's person can do nothing.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string;
let connA: string, projA: string;
let n = 0;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-gr@example.test");
  viewer = await createUser(db, "viewer-gr@example.test");
  service = await createUser(db, "service-gr@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  projA = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'GH project') returning id", [f.tenantA])).rows[0].id as string;
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => { await db.close(); });

/** An initiative linked to a GitHub issue in the given mode, optionally already in the Trash. */
async function setup(o: { mode?: "push" | "follow"; trashed?: boolean } = {}) {
  const num = 500 + ++n;
  const item = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, value_12m, decision, status, initiative_status) values ($1, $2, 'Gone', 777, 'Go', 'Not started', 'On hold') returning id", [f.tenantA, projA])).rows[0].id as string;
  await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'acme/road', $4, $5, $6, 'synced', $7)", [f.tenantA, item, connA, num, num * 10, `https://github.com/acme/road/issues/${num}`, o.mode ?? "push"]);
  if (o.trashed !== false) await db.admin.query("update public.items set deleted_at = now() where id = $1", [item]);
  return { item };
}
const call = (sql: string, params: unknown[], via = "UI") => db.asService((q) => q(sql, params), { commit: true, via });
const link = async (id: string) => (await db.admin.query("select * from public.item_github_links where item_id = $1", [id])).rows[0];
const record = (who: string, id: string, result = "closed", reason: string | null = "not_planned", via = "UI") => call("select public.github_record_removed($1, $2, $3, $4)", [who, id, result, reason], via);

describe("the columns exist", () => {
  it("removed_handled_at, removed_result and removed_reason", async () => {
    await expect(db.admin.query("select removed_handled_at, removed_result, removed_reason from public.item_github_links limit 1")).resolves.toBeDefined();
  });
  it("handled and result go together", async () => {
    const { item } = await setup();
    expect(await errorCode(db.admin.query("update public.item_github_links set removed_handled_at = now() where item_id = $1", [item]))).not.toBeNull();
  });
});

describe("github_record_removed", () => {
  it("records a close for a removed, owned initiative; audited as the person, source UI; nothing else changes", async () => {
    const { item } = await setup();
    await record(creator, item);
    expect(await link(item)).toMatchObject({ removed_result: "closed", removed_reason: "not_planned", mode: "push" });
    expect((await link(item)).removed_handled_at).not.toBeNull();
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'item_github_links' and entity_id = $1 and field = 'removed_result' order by id desc limit 1", [(await link(item)).id])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
    // the initiative itself is untouched: no status, no commercial field, still in the Trash
    const i = (await db.admin.query("select status, initiative_status, value_12m, decision, deleted_at from public.items where id = $1", [item])).rows[0];
    expect(i).toMatchObject({ status: "Not started", initiative_status: "On hold", value_12m: "777.00", decision: "Go" });
    expect(i.deleted_at).not.toBeNull();
  });
  it("already_done and not_found are recorded without a reason", async () => {
    for (const r of ["already_done", "not_found"]) {
      const { item } = await setup();
      await record(creator, item, r, "not_planned");
      expect(await link(item)).toMatchObject({ removed_result: r, removed_reason: null });
    }
  });
  it("is handled once: a second call changes nothing (idempotent)", async () => {
    const { item } = await setup();
    await record(creator, item, "already_done", null);
    const first = await link(item);
    await record(creator, item, "closed");
    expect(await link(item)).toMatchObject({ removed_result: "already_done", removed_handled_at: first.removed_handled_at });
  });
  it("NEVER for an issue that is only followed (mode follow)", async () => {
    const { item } = await setup({ mode: "follow" });
    expect(await errorCode(record(creator, item))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("NEVER for an initiative that is not in the Trash (and so not after a restore either)", async () => {
    const { item } = await setup({ trashed: false });
    expect(await errorCode(record(creator, item))).toBe("22023");
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is refused for a viewer, a service account (Claude's kind) and a person of another workspace; nothing is recorded", async () => {
    const { item } = await setup();
    for (const who of [viewer, service, f.bob]) expect(await errorCode(record(who, item)), who).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is refused when the write comes from Claude (MCP), even for a creator", async () => {
    const { item } = await setup();
    expect(await errorCode(record(creator, item, "closed", "not_planned", "MCP"))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is not callable by a signed-in person or the public: service role only", async () => {
    const { item } = await setup();
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.github_record_removed($1, $2, 'closed', 'not_planned')", [f.alice, item])))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  }, 20000);
  it("rejects an unknown result and an unknown item; an initiative without a link", async () => {
    const { item } = await setup();
    expect(await errorCode(record(creator, item, "reopened"))).toBe("22023");
    expect(await errorCode(record(creator, "99999999-9999-4999-8999-999999999999"))).toBe("P0002");
    const bare = (await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, deleted_at) values ($1, $2, 'No link', now()) returning id", [f.tenantA, projA])).rows[0].id as string;
    expect(await errorCode(record(creator, bare))).toBe("P0002");
  });
});

describe("a stopped initiative (issue #343): Cancelled, and the latest gate decision is a Stop", () => {
  const decide = (item: string, outcome: string, at = "now()") => db.admin.query(
    `insert into public.gate_reviews (tenant_id, item_id, gate, outcome, rationale, decided_by, decided_at) values ($1, $2, 'B', $3, 'Test decision', $4, ${at})`, [f.tenantA, item, outcome, creator]);
  const cancel = (item: string) => db.admin.query("update public.items set initiative_status = 'Cancelled' where id = $1", [item]);
  it("may be recorded like a removed one, for an owned issue; the initiative itself is untouched", async () => {
    const { item } = await setup({ trashed: false });
    await decide(item, "stop"); await cancel(item);
    await record(creator, item);
    expect((await link(item)).removed_handled_at).not.toBeNull();
    expect((await db.admin.query("select initiative_status, deleted_at from public.items where id = $1", [item])).rows[0]).toMatchObject({ initiative_status: "Cancelled", deleted_at: null });
  });
  it("is refused when it is Cancelled without a Stop decision, or has a Stop but was set back to Active", async () => {
    const a = await setup({ trashed: false });
    await cancel(a.item);
    expect(await errorCode(record(creator, a.item))).toBe("22023");
    const b = await setup({ trashed: false });
    await decide(b.item, "stop");
    expect(await errorCode(record(creator, b.item))).toBe("22023"); // still Active
    expect((await link(a.item)).removed_handled_at).toBeNull();
    expect((await link(b.item)).removed_handled_at).toBeNull();
  });
  it("only the latest decision counts: an older Stop followed by a Go is not a stop", async () => {
    const { item } = await setup({ trashed: false });
    await decide(item, "stop", "now() - interval '2 days'"); await decide(item, "go", "now() - interval '1 day'"); await cancel(item);
    expect(await errorCode(record(creator, item))).toBe("22023");
  });
  it("keeps every other boundary: never an issue that is only followed, never a viewer, a service account, another workspace or Claude", async () => {
    const followed = await setup({ mode: "follow", trashed: false });
    await decide(followed.item, "stop"); await cancel(followed.item);
    expect(await errorCode(record(creator, followed.item))).toBe(DENIED);
    const { item } = await setup({ trashed: false });
    await decide(item, "stop"); await cancel(item);
    for (const who of [viewer, service, f.bob]) expect(await errorCode(record(who, item)), who).toBe(DENIED);
    expect(await errorCode(record(creator, item, "closed", "not_planned", "MCP"))).toBe(DENIED);
    expect((await link(item)).removed_handled_at).toBeNull();
  });
  it("is handled once: a second record changes nothing", async () => {
    const { item } = await setup({ trashed: false });
    await decide(item, "stop"); await cancel(item);
    await record(creator, item);
    const first = await link(item);
    await record(creator, item);
    expect(await link(item)).toMatchObject({ removed_handled_at: first.removed_handled_at });
  });
});
