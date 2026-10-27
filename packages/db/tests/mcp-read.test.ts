import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeFields } from "../../domain/src/mcp-read";
import { columnOnItems, FIELD_BY_KEY } from "../../domain/src/registry";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// The MCP read tools (docs/20 FR-2, FR-3, issue #181) read with the caller's own OAuth token, so row-level security is the
// backstop. These tests run the reader's queries as a Claude token (client_id claim) with two tenants.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let fileA: string, fileB: string;
const claude = { client_id: "client-a" };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  const ins = async (sql: string, p: unknown[]) => (await db.admin.query(sql, p)).rows[0].id as string;
  for (const [tenant, item, tag] of [[f.tenantA, f.seedA.items[0], "a"], [f.tenantB, f.seedB.items[0], "b"]] as const) {
    await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, $2)", [tenant, `Group ${tag}`]);
    const file = await ins("insert into public.item_files (tenant_id, item_id, name, storage_path, kind, mime_type, size_bytes) values ($1, $2, $3, $4, 'image', 'image/png', 10) returning id", [tenant, item, `shot-${tag}.png`, `${tenant}/${item}/shot-${tag}.png`]);
    if (tag === "a") fileA = file; else fileB = file;
    await db.admin.query("insert into public.saved_views (tenant_id, name, columns, visibility) values ($1, $2, array['item_code'], 'workspace')", [tenant, `Workspace view ${tag}`]);
  }
  // alice's private view in A: carol (a viewer in A) must not see it
  await db.admin.query("insert into public.saved_views (tenant_id, name, columns, visibility, owner_id) values ($1, 'Alice private', array['item_code'], 'private', $2)", [f.tenantA, f.alice]);
});
afterAll(async () => {
  await db.close();
});

const names = async (user: string, table: string, col = "name", where = "") =>
  db.asUser(user, async (q) => (await q(`select ${col} as v from public.${table} ${where} order by 1`)).rows.map((r) => r.v as string), { claims: claude });

describe("the read tools see their own workspace and nothing else", () => {
  it("a viewer reads items, files, groups, views, projects and teams of their workspace", async () => {
    const items = await db.asUser(f.carol, async (q) => (await q("select id from public.items where tenant_id = $1", [f.tenantA])).rows, { claims: claude });
    expect(items).toHaveLength(3);
    expect(await names(f.carol, "item_files")).toEqual(expect.arrayContaining(["shot-a.png"]));
    expect(await names(f.carol, "item_files")).not.toContain("shot-b.png");
    expect(await names(f.carol, "item_groups")).toEqual(expect.arrayContaining(["Group a"]));
    expect(await names(f.carol, "item_groups")).not.toContain("Group b");
    expect(await names(f.carol, "projects")).toContain("Platform");
    expect(await names(f.carol, "teams")).toContain("Core");
  });

  it("another tenant's rows are unreachable, with or without a tenant filter", async () => {
    for (const table of ["items", "item_files", "item_groups", "saved_views", "projects", "teams", "item_github_links", "github_connections", "github_repositories", "item_relations", "item_links", "item_tags"]) {
      const forB = await db.asUser(f.carol, async (q) => (await q(`select count(*)::int as n from public.${table} where tenant_id = $1`, [f.tenantB])).rows[0].n as number, { claims: claude });
      expect(forB, `${table} for tenant B`).toBe(0);
      const foreign = await db.asUser(f.carol, async (q) => (await q(`select count(*)::int as n from public.${table} where tenant_id <> $1`, [f.tenantA])).rows[0].n as number, { claims: claude });
      expect(foreign, `${table} outside tenant A`).toBe(0);
    }
    const bob = await names(f.bob, "item_files");
    expect(bob).toContain("shot-b.png");
    expect(bob).not.toContain("shot-a.png");
  });

  it("a person outside every workspace reads nothing", async () => {
    expect(await names(f.dave, "items", "initiative_name")).toEqual([]);
    expect(await names(f.dave, "item_files")).toEqual([]);
  });

  it("another person's private view stays private; workspace views are shared", async () => {
    const carol = await names(f.carol, "saved_views");
    expect(carol).toContain("Workspace view a");
    expect(carol).not.toContain("Alice private");
    expect(carol).not.toContain("Workspace view b");
    expect(await names(f.alice, "saved_views")).toEqual(expect.arrayContaining(["Alice private", "Workspace view a"]));
  });

  it("the member directory and an item's activity answer only for the caller's own workspace", async () => {
    const dir = await db.asUser(f.carol, async (q) => (await q("select email from public.tenant_directory($1)", [f.tenantB])).rows, { claims: claude });
    expect(dir).toEqual([]);
    const own = await db.asUser(f.carol, async (q) => (await q("select email from public.tenant_directory($1)", [f.tenantA])).rows.map((r) => r.email), { claims: claude });
    expect(own).toEqual(expect.arrayContaining(["alice@example.test", "carol@example.test"]));
    expect(await errorCode(db.asUser(f.carol, (q) => q("select * from public.item_activity($1)", [f.seedB.items[0]]), { claims: claude }))).toBe("42501");
    await expect(db.asUser(f.carol, (q) => q("select * from public.item_activity($1)", [f.seedA.items[0]]), { claims: claude })).resolves.toBeTruthy();
  });

  it("reading does not write: a Claude token cannot change an item as a viewer", async () => {
    const n = await db.asUser(f.carol, async (q) => (await q("update public.items set summary = 'x' where tenant_id = $1", [f.tenantA])).rowCount, { claims: claude });
    expect(n).toBe(0);
    expect(fileB).toBeTruthy();
    expect(fileA).toBeTruthy();
  });
});

describe("describe_fields agrees with the database", () => {
  const out = describeFields({ role: "admin", reachesGithub: () => false });
  const fresh = async () =>
    (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Schema test', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;

  it("every allowed value it lists for a select that Claude may set is accepted, and any other value is refused", async () => {
    const selects = out.filter((x) => x.type === "Select" && x.allowed && x.shipped && x.claude_may_set);
    expect(selects.length).toBeGreaterThan(5);
    for (const s of selects) {
      const col = columnOnItems(FIELD_BY_KEY[s.key]!);
      if (!col) continue;
      for (const v of s.allowed!) {
        const id = await fresh();
        await db.admin.query(`update public.items set ${col} = $1 where id = $2`, [v, id]);
      }
      const id = await fresh();
      expect(await errorCode(db.admin.query(`update public.items set ${col} = 'not in the list' where id = $1`, [id])), s.key).toBe("23514");
    }
  });

  it("every field it says is stored on items has a column there", async () => {
    const have = new Set((await db.admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'items'")).rows.map((r) => r.column_name as string));
    const missing = out.filter((x) => x.shipped).map((x) => columnOnItems(FIELD_BY_KEY[x.key]!)).filter((c): c is string => c !== null && !have.has(c));
    expect(missing).toEqual([]);
  });
});
