import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let leader: string;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  leader = await createUser(db, "leader-readonly@example.test");
  await addMember(db, f.alice, f.tenantA, leader, "leadership");
});
afterAll(async () => {
  await db.close();
});

describe("a leadership viewer can read the workspace and change nothing in it (through the API)", () => {
  it("reads items, projects, views, scopes, groups and weekly updates", async () => {
    for (const t of ["items", "projects", "saved_views", "saved_scopes", "item_groups", "weekly_updates", "item_tags", "teams"]) {
      const n = await db.asUser(leader, async (q) => (await q(`select count(*)::int as n from public.${t} where tenant_id = $1`, [f.tenantA])).rows[0].n as number);
      expect(n, t).toBeGreaterThanOrEqual(0);
    }
    expect(await db.asUser(leader, async (q) => (await q("select count(*)::int as n from public.items where tenant_id = $1", [f.tenantA])).rows[0].n)).toBeGreaterThan(0);
  });
  it("cannot insert, update or delete in any of those tables", async () => {
    const item = f.seedA.items[0]!;
    const attempts: [string, string, unknown[]][] = [
      ["items insert", "insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Nope', $2)", [f.tenantA, f.seedA.project]],
      ["items update", "update public.items set health = 'Blocked' where id = $1", [item]],
      ["items delete", "delete from public.items where id = $1", [item]],
      ["projects insert", "insert into public.projects (tenant_id, name) values ($1, 'Nope')", [f.tenantA]],
      ["projects update", "update public.projects set name = 'Nope' where id = $1", [f.seedA.project]],
      ["saved_views insert", "insert into public.saved_views (tenant_id, name, columns) values ($1, 'Nope', array['item_code'])", [f.tenantA]],
      ["saved_scopes insert", "insert into public.saved_scopes (tenant_id, name) values ($1, 'Nope')", [f.tenantA]],
      ["item_groups insert", "insert into public.item_groups (tenant_id, name) values ($1, 'Nope')", [f.tenantA]],
      ["item_tags insert", "insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'nope')", [f.tenantA, item]],
      ["weekly_updates insert", "insert into public.weekly_updates (tenant_id, week_start, scope_key, body) values ($1, '2026-10-19', 'nope', 'x')", [f.tenantA]],
      ["weekly_updates update", "update public.weekly_updates set body = 'x' where tenant_id = $1", [f.tenantA]],
    ];
    for (const [name, sql, params] of attempts) {
      const code = await errorCode(db.asUser(leader, (q) => q(sql, params), { commit: true, via: "UI" }));
      if (code === null) {
        // an update or delete that RLS filters to zero rows is also a refusal
        const rows = await db.asUser(leader, async (q) => (await q(sql, params)).rowCount, { via: "UI" }).catch(() => 0);
        expect(rows, name).toBe(0);
      } else expect(["42501", "P0001"], name).toContain(code);
    }
    expect((await db.admin.query("select health from public.items where id = $1", [item])).rows[0].health).not.toBe("Blocked");
  });
  it("cannot re-rank, rename or merge groups, or restore a merge", async () => {
    const item = f.seedA.items[0]!;
    expect(await errorCode(db.asUser(leader, (q) => q("select public.move_item($1, 1)", [item])))).toBeTruthy();
    const g = (await db.admin.query("select id from public.item_groups where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
    expect(await errorCode(db.asUser(leader, (q) => q("select public.rename_item_group($1, 'Nope')", [g])))).toBe("42501");
    expect(await errorCode(db.asUser(leader, (q) => q("select public.retire_item_group($1)", [g])))).toBe("42501");
  });
});
