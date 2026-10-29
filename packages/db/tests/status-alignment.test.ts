import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { MIGRATIONS_DIR, migrate } from "../src/migrate.mjs";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #247: Build Status, Initiative Status and Planning Status get new values; existing rows are rewritten, and rewrites are audited.
const MINE = "20261028225223_status_alignment_values.sql";
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
const ids: Record<string, string> = {};

const seed = async (key: string, cols: Record<string, string | null>) => {
  const names = ["tenant_id", "home_project_id", "initiative_name", ...Object.keys(cols)];
  const home = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  const vals = [f.tenantA, home, `Item ${key}`, ...Object.values(cols)];
  ids[key] = (await db.admin.query(`insert into public.items (${names.join(", ")}) values (${vals.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals)).rows[0].id;
};
const item = async (key: string) => (await db.admin.query("select status, initiative_status, planning_status, initiative_phase from public.items where id = $1", [ids[key]])).rows[0];

beforeAll(async () => {
  db = await createTestDb({ migrations: false });
  const before = mkdtempSync(path.join(tmpdir(), "pv-before-"));
  for (const n of readdirSync(MIGRATIONS_DIR)) if (n.endsWith(".sql") && n < MINE) copyFileSync(path.join(MIGRATIONS_DIR, n), path.join(before, n));
  await migrate(db.admin, before);
  f = await twoTenantFixture(db);
  await seed("a", { status: "Backlog", initiative_status: "Backlog" });
  await seed("b", { status: "Not Started", initiative_status: "Not Started" });
  await seed("c", { status: "In Progress", initiative_status: "In Progress" });
  await seed("d", { status: "Paused", initiative_status: "Paused" });
  await seed("e", { status: "Completed", initiative_status: "Completed" });
  await seed("f", { status: "Cancelled", initiative_status: "Cancelled", initiative_phase: "Build" });
  await seed("g", { initiative_status: "Completed", initiative_phase: "Roll-out" });
  await seed("h", {});
  await migrate(db.admin);
});
afterAll(async () => {
  await db.close();
});

describe("status alignment migration", () => {
  it("rewrites Build Status to the tracker vocabulary", async () => {
    expect(await Promise.all(["a", "b", "c", "d", "e", "f", "h"].map(async (k) => (await item(k)).status))).toEqual(["Not started", "Not started", "In progress", "In progress", "Done", "Cancelled", null]);
  });

  it("moves Backlog and Not Started to Planning Status and shrinks Initiative Status", async () => {
    expect(await item("a")).toMatchObject({ initiative_status: null, planning_status: "Backlog" });
    expect(await item("b")).toMatchObject({ initiative_status: null, planning_status: "Not started" });
    expect(await item("c")).toMatchObject({ initiative_status: "Active", planning_status: null });
    expect(await item("d")).toMatchObject({ initiative_status: "On hold" });
    expect(await item("f")).toMatchObject({ initiative_status: "Cancelled", initiative_phase: "Build" });
  });

  it("a finished initiative reads Completed: phase set when there was none, and Initiative Status Completed when the phase says it is over", async () => {
    expect(await item("e")).toMatchObject({ initiative_status: "Completed", initiative_phase: "Completed" });
    expect(await item("g")).toMatchObject({ initiative_status: null, initiative_phase: "Roll-out" }); // a set phase is left alone
    expect(await item("h")).toMatchObject({ initiative_status: null });
  });

  it("audits the rewrites", async () => {
    const { rows } = await db.admin.query("select new from public.audit_log where entity = 'items' and entity_id = $1 and field = 'initiative_status' order by id desc limit 1", [ids.c]);
    expect(rows[0].new).toBe("Active");
  });

  it("refuses old and unknown values, for people and for the tracker", async () => {
    for (const v of ["In Progress", "Paused", "Sleeping"]) expect(await errorCode(db.admin.query("update public.items set initiative_status = $1 where id = $2", [v, ids.c]))).toBe("23514");
    for (const v of ["In Progress", "Completed", "Sleeping"]) expect(await errorCode(db.admin.query("update public.items set status = $1 where id = $2", [v, ids.c]))).toBe("23514");
    expect(await errorCode(db.admin.query("update public.items set planning_status = 'Maybe' where id = $1", [ids.c]))).toBe("23514");
    await db.admin.query("update public.items set planning_status = 'Committed', initiative_status = 'On hold', status = 'Done' where id = $1", [ids.c]);
    expect(await item("c")).toMatchObject({ planning_status: "Committed", initiative_status: "On hold", status: "Done" });
  });

  it("people set Planning Status and Initiative Status, nobody signed in sets Build Status", async () => {
    await db.asUser(f.alice, (q) => q("update public.items set planning_status = 'Included', initiative_status = 'Active' where id = $1", [ids.c]), { commit: true });
    expect(await item("c")).toMatchObject({ planning_status: "Included", initiative_status: "Active" });
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.items set status = 'Done' where id = $1", [ids.h])))).toBe("42501");
  });
});
