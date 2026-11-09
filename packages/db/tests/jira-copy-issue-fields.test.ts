import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, robot: string, conn: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-jcopy@example.test");
  viewer = await createUser(db, "viewer-jcopy@example.test");
  robot = await createUser(db, "robot-jcopy@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, robot, "creator", { serviceAccount: true });
  conn = (await db.admin.query("select id from public.jira_connections where tenant_id = $1", [f.tenantA])).rows[0].id;
});
afterAll(async () => { await db.close(); });

const project = async () => (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
/** An initiative as the Jira pull-in makes it: named after the issue, source "Jira issue KEY", with a Jira link. */
async function pulledItem(n: number, opts: { source?: string; description?: string | null; link?: boolean; mode?: string } = {}) {
  const r = await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source, description) values ($1, $2, $3, $4, $5) returning id", [f.tenantA, await project(), `Issue ${n}`, opts.source ?? `Jira issue PAY-${n}`, opts.description ?? null]);
  const id = r.rows[0].id as string;
  if (opts.link !== false) await db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, jira_status_category) values ($1, $2, $3, 'site-1', $4, $5, 'https://x.atlassian.net/browse/PAY-1', $6, 'new')", [f.tenantA, id, conn, `PAY-${n}`, String(9000 + n), opts.mode ?? "follow"]);
  return id;
}
const copy = (actor: string, item: string, text: string | null) =>
  db.asService(async (q) => (await q("select public.jira_copy_issue_description($1, $2, $3) as r", [actor, item, text])).rows[0].r as boolean, { commit: true, via: "UI" });
const labels = (actor: string, item: string, changeType: string | null, area: string | null) =>
  db.asService(async (q) => (await q("select public.jira_copy_issue_labels($1, $2, $3, $4) as r", [actor, item, changeType, area])).rows[0].r as Record<string, boolean>, { commit: true, via: "UI" });
const row = async (id: string) => (await db.admin.query("select description, change_type, focus_area from public.items where id = $1", [id])).rows[0] as { description: string | null; change_type: string | null; focus_area: string | null };

describe("jira_copy_issue_description (pull-in keeps the Jira issue's text)", () => {
  it("stores the text for a read-only and for an owned pulled-in initiative, and audits the person", async () => {
    const a = await pulledItem(1);
    expect(await copy(creator, a, "## Goal\nThe IO builder")).toBe(true);
    expect((await row(a)).description).toBe("## Goal\nThe IO builder");
    const b = await pulledItem(2, { mode: "push" });
    expect(await copy(creator, b, "Owned")).toBe(true);
    const audit = (await db.admin.query("select actor_id from public.audit_log where entity = 'items' and entity_id = $1 and field = 'description'", [a])).rows;
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(creator);
  });
  it("never replaces a description a person wrote, ignores empty text, cuts at 20,000 characters", async () => {
    const mine = await pulledItem(3, { description: "Written in Product Velocity" });
    expect(await copy(creator, mine, "From Jira")).toBe(false);
    expect((await row(mine)).description).toBe("Written in Product Velocity");
    const id = await pulledItem(4);
    expect(await copy(creator, id, "  ")).toBe(false);
    expect(await copy(creator, id, null)).toBe(false);
    expect(await copy(creator, id, "x".repeat(25000))).toBe(true);
    expect((await row(id)).description).toHaveLength(20000);
  });
  it("only touches initiatives made by the Jira pull-in with a Jira link (not a GitHub one)", async () => {
    await expect(copy(creator, await pulledItem(5, { source: "Customer interview" }), "x")).rejects.toThrow(/not pulled in/);
    await expect(copy(creator, await pulledItem(6, { link: false }), "x")).rejects.toThrow(/not pulled in/);
    await expect(copy(creator, await pulledItem(7, { source: "GitHub issue #7" }), "x")).rejects.toThrow(/not pulled in/);
  });
  it("is refused for a viewer, a service account and a person of another workspace; only the service role may call it", async () => {
    const id = await pulledItem(8);
    for (const who of [viewer, robot, f.bob]) await expect(copy(who, id, "x").catch((e) => { throw Object.assign(new Error(e.message), { code: e.code }); })).rejects.toMatchObject({ code: DENIED });
    expect((await row(id)).description).toBeNull();
    await expect(db.asUser(f.alice, (q) => q("select public.jira_copy_issue_description($1, $2, 'x')", [f.alice, id]))).rejects.toThrow();
  });
});

describe("jira_copy_issue_labels (type: is Change Type, area: is Focus Area)", () => {
  it("stores both, accepts Bug, and audits the person", async () => {
    const id = await pulledItem(20);
    expect(await labels(creator, id, "New feature", "admin")).toEqual({ change_type: true, focus_area: true });
    expect(await row(id)).toMatchObject({ change_type: "New feature", focus_area: "admin" });
    const audit = (await db.admin.query("select field, actor_id from public.audit_log where entity = 'items' and entity_id = $1 and field in ('change_type', 'focus_area')", [id])).rows;
    expect(audit.map((a) => a.field).sort()).toEqual(["change_type", "focus_area"]);
    expect(audit.every((a) => a.actor_id === creator)).toBe(true);
    const bug = await pulledItem(21);
    expect(await labels(creator, bug, "Bug", null)).toEqual({ change_type: true });
  });
  it("never replaces a value a person chose, refuses an unknown Change Type, cuts the Focus Area at 120", async () => {
    const id = await pulledItem(22);
    await db.admin.query("update public.items set change_type = 'Improvement to existing feature', focus_area = 'Publishers' where id = $1", [id]);
    expect(await labels(creator, id, "New feature", "admin")).toEqual({});
    expect(await row(id)).toMatchObject({ change_type: "Improvement to existing feature", focus_area: "Publishers" });
    const other = await pulledItem(23);
    await expect(labels(creator, other, "Chore", null)).rejects.toThrow(/cannot set Change Type/);
    expect(await labels(creator, other, null, "y".repeat(200))).toEqual({ focus_area: true });
    expect((await row(other)).focus_area).toHaveLength(120);
  });
  it("has the same guards as the description copy", async () => {
    await expect(labels(creator, await pulledItem(24, { source: "Customer interview" }), "Bug", null)).rejects.toThrow(/not pulled in/);
    const id = await pulledItem(25);
    for (const who of [viewer, robot, f.bob]) await expect(labels(who, id, "Bug", "x").catch((e) => { throw Object.assign(new Error(e.message), { code: e.code }); })).rejects.toMatchObject({ code: DENIED });
    expect(await row(id)).toMatchObject({ change_type: null, focus_area: null });
    await expect(db.asUser(f.alice, (q) => q("select public.jira_copy_issue_labels($1, $2, 'Bug', 'x')", [f.alice, id]))).rejects.toThrow();
  });
});
