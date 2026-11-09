import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, robot: string, conn: string;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-copy@example.test");
  viewer = await createUser(db, "viewer-copy@example.test");
  robot = await createUser(db, "robot-copy@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, robot, "creator", { serviceAccount: true });
  conn = (await db.admin.query("select id from public.github_connections where tenant_id = $1", [f.tenantA])).rows[0].id;
});
afterAll(async () => { await db.close(); });

const project = async () => (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
/** An initiative as the pull-in makes it: named after the issue, source "GitHub issue #N", with a link. */
async function pulledItem(n: number, opts: { source?: string; description?: string | null; link?: boolean } = {}) {
  const r = await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name, source, description) values ($1, $2, $3, $4, $5) returning id", [f.tenantA, await project(), `Issue ${n}`, opts.source ?? `GitHub issue #${n}`, opts.description ?? null]);
  const id = r.rows[0].id as string;
  if (opts.link !== false) await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', 'follow')", [f.tenantA, id, conn, 1000 + n, 5000 + n]);
  return id;
}
const copy = (actor: string, item: string, text: string | null) =>
  db.asService(async (q) => (await q("select public.github_copy_issue_description($1, $2, $3) as r", [actor, item, text])).rows[0].r as boolean, { commit: true, via: "UI" });
const description = async (id: string) => (await db.admin.query("select description from public.items where id = $1", [id])).rows[0].description as string | null;

describe("github_copy_issue_description (pull-in keeps the issue's text)", () => {
  it("stores the text of a read-only (follow) pulled-in initiative and audits the person", async () => {
    const id = await pulledItem(1);
    expect(await copy(creator, id, "## Goal\nThe IO builder")).toBe(true);
    expect(await description(id)).toBe("## Goal\nThe IO builder");
    const audit = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'description'", [id])).rows;
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(creator);
  });
  it("never replaces a description a person already wrote", async () => {
    const id = await pulledItem(2, { description: "Written in Product Velocity" });
    expect(await copy(creator, id, "From GitHub")).toBe(false);
    expect(await description(id)).toBe("Written in Product Velocity");
  });
  it("cuts the text at 20,000 characters and ignores an empty one", async () => {
    const id = await pulledItem(3);
    expect(await copy(creator, id, "   ")).toBe(false);
    expect(await copy(creator, id, null)).toBe(false);
    expect(await copy(creator, id, "x".repeat(25000))).toBe(true);
    expect((await description(id))!.length).toBe(20000);
  });
  it("only touches initiatives made by the pull-in, and only with a GitHub link", async () => {
    const own = await pulledItem(4, { source: "Customer interview" });
    await expect(copy(creator, own, "x")).rejects.toThrow(/not pulled in/);
    const unlinked = await pulledItem(5, { link: false });
    await expect(copy(creator, unlinked, "x")).rejects.toThrow(/not pulled in/);
  });
  it("is refused for a viewer, a service account, and a person of another workspace", async () => {
    const id = await pulledItem(6);
    for (const who of [viewer, robot, f.bob]) {
      await expect(copy(who, id, "x").catch((e) => { throw Object.assign(new Error(e.message), { code: e.code }); })).rejects.toMatchObject({ code: DENIED });
    }
    expect(await description(id)).toBeNull();
  });
  it("only the service role may call it", async () => {
    const id = await pulledItem(7);
    await expect(db.asUser(f.alice, (q) => q("select public.github_copy_issue_description($1, $2, 'x')", [f.alice, id]))).rejects.toThrow();
  });
});
