import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { migrate } from "../src/migrate.mjs";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ migrations: false });
});
afterAll(async () => {
  await db.close();
});

function dirWith(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "pv-mig-"));
  for (const [n, sql] of Object.entries(files)) writeFileSync(path.join(dir, n), sql);
  return dir;
}

describe("forward-only migrations", () => {
  const dir = dirWith({
    "0001_a.sql": "create table public.t_a (id int);",
    "0002_b.sql": "create table public.t_b (id int);",
  });

  it("applies in order and records them", async () => {
    expect(await migrate(db.admin, dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
  });

  it("is idempotent", async () => {
    expect(await migrate(db.admin, dir)).toEqual([]);
  });

  it("applies timestamp-named files after the legacy ones, in time order", async () => {
    const d = dirWith({
      "0001_a.sql": "create table public.t_ts_a (id int);",
      "0058_z.sql": "create table public.t_ts_z (id int);",
      "20261029090000_later.sql": "create table public.t_ts_later (id int);",
      "20261028100000_first.sql": "create table public.t_ts_first (id int);",
      "ignored.sql": "this is not a migration",
    });
    const fresh = await createTestDb({ migrations: false }); // its own database: the shared one already holds other files
    try {
      expect(await migrate(fresh.admin, d)).toEqual(["0001_a.sql", "0058_z.sql", "20261028100000_first.sql", "20261029090000_later.sql"]);
    } finally {
      await fresh.close();
    }
  });

  it("applies only new files", async () => {
    writeFileSync(path.join(dir, "0003_c.sql"), "create table public.t_c (id int);");
    expect(await migrate(db.admin, dir)).toEqual(["0003_c.sql"]);
  });

  it("refuses to run when an applied migration was edited", async () => {
    writeFileSync(path.join(dir, "0001_a.sql"), "create table public.t_a (id int, extra int);");
    await expect(migrate(db.admin, dir)).rejects.toThrow(/edited after being applied/);
  });

  it("refuses when an applied migration file is missing", async () => {
    const other = dirWith({ "0001_a.sql": "select 1;" });
    await expect(migrate(db.admin, other)).rejects.toThrow(/missing/);
  });

  it("rolls back a failing migration entirely", async () => {
    const d = dirWith({ "0001_x.sql": "create table public.t_ok (id int); select 1/0;" });
    const fresh = await createTestDb({ migrations: false });
    await expect(migrate(fresh.admin, d)).rejects.toThrow(/0001_x.sql failed/);
    const { rows } = await fresh.admin.query("select to_regclass('public.t_ok') as t");
    expect(rows[0].t).toBeNull();
    await fresh.close();
  });
});

describe("the real migrations", () => {
  it("apply cleanly to an empty database", async () => {
    const fresh = await createTestDb();
    const { rows } = await fresh.admin.query("select count(*)::int n from pv_meta.schema_migrations");
    expect(rows[0].n).toBeGreaterThan(0);
    await fresh.close();
  });
});
