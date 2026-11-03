import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs runner
import { migrate, MIGRATIONS_DIR } from "../src/migrate.mjs";
import { createTestDb, type TestDb } from "./helpers";

// Issue #289: the migration that renames the write source "Claude MCP" to "MCP" must also rewrite the history that already exists.
const LAST = "20261103004500_mcp_source_and_ai_name.sql";
let db: TestDb;
let dir: string;
let before: { audit: number; tenants: number };

beforeAll(async () => {
  db = await createTestDb({ migrations: false });
  dir = mkdtempSync(path.join(tmpdir(), "pv-mig-"));
  for (const f of readdirSync(MIGRATIONS_DIR as string)) if (f < LAST) cpSync(path.join(MIGRATIONS_DIR as string, f), path.join(dir, f));
  await migrate(db.admin, dir);
  // history written the old way: tenants created through Claude, and one through the UI
  await db.admin.query("select set_config('app.via', 'Claude MCP', false)");
  await db.admin.query("insert into public.tenants (name) values ('Old Claude A'), ('Old Claude B')");
  await db.admin.query("select set_config('app.via', 'UI', false)");
  await db.admin.query("insert into public.tenants (name) values ('Old UI')");
  await db.admin.query("select set_config('app.via', '', false)");
  before = {
    audit: Number((await db.admin.query("select count(*) n from public.audit_log")).rows[0].n),
    tenants: Number((await db.admin.query("select count(*) n from public.tenants")).rows[0].n),
  };
  await migrate(db.admin, MIGRATIONS_DIR); // applies only the new one
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.close();
});

describe("migration: write source Claude MCP becomes MCP", () => {
  it("rewrites created_via of existing rows and leaves the others", async () => {
    const r = await db.admin.query("select name, created_via from public.tenants where name like 'Old %' order by name");
    expect(r.rows).toEqual([
      { name: "Old Claude A", created_via: "MCP" },
      { name: "Old Claude B", created_via: "MCP" },
      { name: "Old UI", created_via: "UI" },
    ]);
  });

  it("rewrites the audit history, gives it AI name claude, and adds no audit rows", async () => {
    expect(Number((await db.admin.query("select count(*) n from public.audit_log")).rows[0].n)).toBe(before.audit);
    expect((await db.admin.query("select count(*) n from public.audit_log where via = 'Claude MCP'")).rows[0].n).toBe("0");
    const mcp = await db.admin.query("select distinct via, ai_tool from public.audit_log where via = 'MCP'");
    expect(mcp.rows).toEqual([{ via: "MCP", ai_tool: "claude" }]);
    const ui = await db.admin.query("select distinct ai_tool from public.audit_log where via = 'UI'");
    expect(ui.rows).toEqual([{ ai_tool: null }]);
    // the entry that recorded the creation source holds the new value too
    const f = await db.admin.query("select distinct new #>> '{}' as v from public.audit_log where field = 'created_via' and via = 'MCP'");
    expect(f.rows).toEqual([{ v: "MCP" }]);
  });

  it("keeps the audit log append-only after the migration", async () => {
    await expect(db.admin.query("update public.audit_log set field = field")).rejects.toThrow(/append-only/);
    await expect(db.admin.query("delete from public.audit_log")).rejects.toThrow(/append-only/);
  });

  it("keeps the other triggers on: a new tenant still gets its audit rows", async () => {
    await db.admin.query("insert into public.tenants (name) values ('New')");
    expect(Number((await db.admin.query("select count(*) n from public.audit_log")).rows[0].n)).toBeGreaterThan(before.audit);
    expect(before.tenants).toBeGreaterThan(0);
  });
});
