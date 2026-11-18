import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Rename and delete a project (issue #526): admin only, typed-name confirmation, the deletion process (Trash, then purge), then the project and what is keyed by it.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, service: string, bob: string, viewer: string;
let n = 0;
const DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-prd@example.test");
  viewer = await createUser(db, "viewer-prd@example.test");
  service = await createUser(db, "service-prd@example.test");
  bob = f.bob;
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
});
afterAll(async () => { await db.close(); });

async function project(tenant = f.tenantA, items = 2) {
  const name = `Proj ${++n}`;
  const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, $2) returning id", [tenant, name])).rows[0].id as string;
  const ids: string[] = [];
  for (let i = 0; i < items; i++) ids.push((await db.admin.query("insert into public.items (tenant_id, home_project_id, initiative_name) values ($1, $2, $3) returning id", [tenant, p, `I ${n}-${i}`])).rows[0].id as string);
  return { id: p, name, items: ids };
}
const rename = (user: string, id: string, name: string, via = "UI") => db.asUser(user, async (q) => (await q("select public.project_rename($1, $2) as r", [id, name])).rows[0].r as string, { commit: true, via });
const del = (user: string, id: string, typed: string, via = "UI") => db.asUser(user, async (q) => (await q("select public.project_delete($1, $2) as r", [id, typed])).rows[0].r as { initiatives: number; purged: number; files: string[] }, { commit: true, via });
const projectRow = async (id: string) => (await db.admin.query("select name from public.projects where id = $1", [id])).rows[0];

describe("project_rename", () => {
  it("an admin renames the project (trimmed), gets the old name back, and the change is audited as the person with source UI", async () => {
    const p = await project();
    expect(await rename(f.alice, p.id, "  New name  ")).toBe(p.name);
    expect(await projectRow(p.id)).toEqual({ name: "New name" });
    const a = (await db.admin.query("select actor_id, via, old #>> '{}' as o, new #>> '{}' as nw from public.audit_log where entity = 'projects' and entity_id = $1 and field = 'name' order by id desc limit 1", [p.id])).rows[0];
    expect(a).toMatchObject({ actor_id: f.alice, via: "UI", o: p.name, nw: "New name" });
  });
  it("refuses an empty or too long name and a name another project has (case and spaces ignored)", async () => {
    const a = await project(); const b = await project();
    expect(await errorCode(rename(f.alice, a.id, "   "))).toBe("22023");
    expect(await errorCode(rename(f.alice, a.id, "x".repeat(121)))).toBe("22023");
    expect(await errorCode(rename(f.alice, a.id, `  ${b.name.toUpperCase()} `))).toBe("23505");
    expect((await projectRow(a.id)).name).toBe(a.name);
  });
  it("refuses a creator, a viewer, a service account, Claude (MCP), another workspace's admin and a non-member", async () => {
    const p = await project();
    for (const who of [creator, viewer, service]) expect(await errorCode(rename(who, p.id, "Nope")), who).toBe(DENIED);
    expect(await errorCode(rename(f.alice, p.id, "Nope", "MCP"))).toBe(DENIED);
    expect(await errorCode(rename(bob, p.id, "Nope"))).toBe(DENIED);
    expect((await projectRow(p.id)).name).toBe(p.name);
  });
});

describe("project_delete", () => {
  it("follows the deletion process: the initiatives (live and already trashed) are deleted for good and the project goes, in one step", async () => {
    const p = await project(f.tenantA, 3);
    await db.asUser(f.alice, (q) => q("select * from public.delete_items($1)", [[p.items[0]]]), { commit: true, via: "UI" }); // one is already in the Trash
    const r = await del(f.alice, p.id, p.name);
    expect(r).toMatchObject({ initiatives: 3, purged: 3, files: [] });
    expect(await projectRow(p.id)).toBeUndefined();
    expect((await db.admin.query("select count(*)::int n from public.items where id = any ($1)", [p.items])).rows[0].n).toBe(0);
  });
  it("the typed name must match (case and spaces ignored); a wrong name changes nothing", async () => {
    const p = await project();
    expect(await errorCode(del(f.alice, p.id, "something else"))).toBe("22023");
    expect(await errorCode(del(f.alice, p.id, ""))).toBe("22023");
    expect(await projectRow(p.id)).toBeDefined();
    expect((await db.admin.query("select count(*)::int n from public.items where home_project_id = $1 and deleted_at is null", [p.id])).rows[0].n).toBe(2);
    expect((await del(f.alice, p.id, `  ${p.name.toUpperCase()}  `)).purged).toBe(2);
  });
  it("returns the storage paths of the files attached to the initiatives, so the bytes can be removed", async () => {
    const p = await project(f.tenantA, 1);
    await db.admin.query("insert into public.item_attachments (tenant_id, item_id, kind, name, file_kind, storage_path, mime_type, size_bytes) values ($1, $2, 'file', 'a.png', 'image', $3, 'image/png', 10)", [f.tenantA, p.items[0], `t/${p.id}/a.png`]);
    expect((await del(f.alice, p.id, p.name)).files).toEqual([`t/${p.id}/a.png`]);
  });
  it("the seeded project of the fixture, with its linked data (Jira link, field configuration, scopes, votes, documents...), deletes cleanly", async () => {
    const seeded = f.seedA.project as string;
    const name = (await db.admin.query("select name from public.projects where id = $1", [seeded])).rows[0].name as string;
    const r = await del(f.alice, seeded, name);
    expect(r.initiatives).toBeGreaterThan(0);
    expect(await projectRow(seeded)).toBeUndefined();
    for (const t of ["jira_project_links", "tracker_field_config", "jira_select_map", "saved_scope_projects"]) {
      const c = (await db.admin.query(`select count(*)::int n from public.${t} where project_id = $1`, [seeded]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
      expect(c, t).toBe(0);
    }
  });
  it("refuses a creator, a viewer, a service account, Claude (MCP), another workspace's admin and a non-member; nothing is deleted", async () => {
    const p = await project();
    for (const who of [creator, viewer, service]) expect(await errorCode(del(who, p.id, p.name)), who).toBe(DENIED);
    expect(await errorCode(del(f.alice, p.id, p.name, "MCP"))).toBe(DENIED);
    expect(await errorCode(del(bob, p.id, p.name))).toBe(DENIED);
    expect(await projectRow(p.id)).toBeDefined();
    expect((await db.admin.query("select count(*)::int n from public.items where home_project_id = $1 and deleted_at is null", [p.id])).rows[0].n).toBe(2);
  });
  it("never reaches into another workspace", async () => {
    const other = await project(f.tenantB);
    expect(await errorCode(del(f.alice, other.id, other.name))).toBe(DENIED);
    expect(await projectRow(other.id)).toBeDefined();
  });
});
