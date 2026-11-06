import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM modules without types
import { runCheck } from "../src/check.mjs";
// @ts-expect-error plain ESM modules without types
import { backfillSql, compareMigrations, listMigrationFiles } from "../src/pending.mjs";
import { createTestDb, createUser, errorCode, type TestDb } from "./helpers";

// Issue #344: the deploy-time check. On 2026-11-05 the live database lacked three migrations the deployed code needed and every Jira and GitHub
// read failed; the check keeps such a release from replacing the working deployment.
type F = { name: string; checksum: string };
const files: F[] = [{ name: "0001_a.sql", checksum: "h1" }, { name: "20261105000000_b.sql", checksum: "h2" }, { name: "20261106000000_c.sql", checksum: "h3" }];
const env = (over: Record<string, string> = {}) => ({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", ...over });
const answer = (status: number, body: unknown = []) => (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as never;
const applied = (...fs: F[]) => fs.map((f) => ({ name: f.name, checksum: f.checksum }));

describe("compareMigrations", () => {
  it("lists pending, edited and unknown migrations", () => {
    const r = compareMigrations(files, [{ name: "0001_a.sql", checksum: "h1" }, { name: "20261105000000_b.sql", checksum: "CHANGED" }, { name: "gone.sql", checksum: "z" }]);
    expect(r).toEqual({ pending: ["20261106000000_c.sql"], edited: ["20261105000000_b.sql"], unknown: ["gone.sql"] });
  });
  it("is empty when everything is recorded", () => {
    expect(compareMigrations(files, applied(...files))).toEqual({ pending: [], edited: [], unknown: [] });
  });
});

describe("listMigrationFiles and backfillSql", () => {
  it("reads the real migrations in order with a checksum each", () => {
    const list = listMigrationFiles() as F[];
    expect(list.length).toBeGreaterThan(80);
    expect(list.map((f) => f.name)).toEqual([...list.map((f) => f.name)].sort());
    expect(list.every((f) => /^[0-9a-f]{64}$/.test(f.checksum))).toBe(true);
  });
  it("records without running, and is idempotent", () => {
    const sql = backfillSql(files) as string;
    expect(sql).toContain("insert into pv_meta.schema_migrations (name, checksum) values");
    expect(sql).toContain("('0001_a.sql', 'h1')");
    expect(sql).toContain("on conflict (name) do nothing;");
    expect(sql).toContain("does NOT run them");
  });
  it("checksums match what migrate.mjs records", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
    writeFileSync(path.join(dir, "20261106000000_x.sql"), "select 1;\n");
    const [f] = listMigrationFiles(dir) as F[];
    const { createHash } = await import("node:crypto");
    expect(f!.checksum).toBe(createHash("sha256").update("select 1;\n").digest("hex"));
  });
});

describe("runCheck", () => {
  it("fails the build in enforce mode when a migration is pending (the 0.98 case)", async () => {
    const r = await runCheck({ env: env({ MIGRATION_CHECK: "enforce" }), files, fetchFn: answer(200, applied(files[0]!, files[1]!)) });
    expect(r.exit).toBe(1);
    expect(r.lines.join("\n")).toContain("20261106000000_c.sql");
    expect(r.lines.join("\n")).toContain("previous deployment stays live");
  });
  it("fails in enforce mode when an applied migration was edited", async () => {
    const r = await runCheck({ env: env({ MIGRATION_CHECK: "enforce" }), files, fetchFn: answer(200, [...applied(files[0]!, files[2]!), { name: files[1]!.name, checksum: "other" }]) });
    expect(r.exit).toBe(1);
    expect(r.lines.join("\n")).toContain("edited afterwards");
  });
  it("only warns by default and in warn mode", async () => {
    for (const e of [env(), env({ MIGRATION_CHECK: "warn" })]) {
      const r = await runCheck({ env: e, files, fetchFn: answer(200, applied(files[0]!)) });
      expect(r.exit).toBe(0);
      expect(r.lines.join("\n")).toContain("20261105000000_b.sql");
    }
  });
  it("passes when the database has everything", async () => {
    const r = await runCheck({ env: env({ MIGRATION_CHECK: "enforce" }), files, fetchFn: answer(200, applied(...files)) });
    expect(r).toMatchObject({ exit: 0 });
  });
  it("never fails the build when it cannot check, even in enforce mode", async () => {
    const enforce = { MIGRATION_CHECK: "enforce" };
    const cases = [
      runCheck({ env: { MIGRATION_CHECK: "enforce" }, files, fetchFn: answer(200) }), // no credentials
      runCheck({ env: env(enforce), files, fetchFn: answer(404) }), // function not there yet
      runCheck({ env: env(enforce), files, fetchFn: answer(401) }),
      runCheck({ env: env(enforce), files, fetchFn: answer(500) }),
      runCheck({ env: env(enforce), files, fetchFn: answer(200, { message: "not a list" }) }),
      runCheck({ env: env(enforce), files, fetchFn: (async () => { throw new Error("offline"); }) as never }),
    ];
    for (const r of await Promise.all(cases)) {
      expect(r.exit).toBe(0);
      expect(r.lines.join("\n")).toContain("skipped");
    }
  });
  it("off skips without calling the database; a mistyped mode fails loudly", async () => {
    let called = false;
    const spy = (async () => { called = true; return { status: 200, ok: true, json: async () => [] }; }) as never;
    expect((await runCheck({ env: env({ MIGRATION_CHECK: "off" }), files, fetchFn: spy })).exit).toBe(0);
    expect(called).toBe(false);
    expect((await runCheck({ env: env({ MIGRATION_CHECK: "enfroce" }), files, fetchFn: spy })).exit).toBe(1);
  });
  it("never prints the key or the URL", async () => {
    const r = await runCheck({ env: env({ MIGRATION_CHECK: "enforce" }), files, fetchFn: answer(200, applied(files[0]!)) });
    expect(r.lines.join("\n")).not.toMatch(/service-key|supabase\.co/);
  });
});

describe("public.schema_migrations_applied()", () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.close(); });

  it("returns the recorded names and checksums to the service role", async () => {
    await db.admin.query("insert into pv_meta.schema_migrations (name, checksum) values ('99990101000000_probe.sql', 'abc') on conflict do nothing");
    const r = await db.asService((q) => q("select name, checksum from public.schema_migrations_applied() where name = '99990101000000_probe.sql'"));
    expect(r.rows).toEqual([{ name: "99990101000000_probe.sql", checksum: "abc" }]);
  });
  it("is refused to signed-in users and anonymous visitors", async () => {
    const alice = await createUser(db, "alice-mig@example.com");
    expect(await errorCode(db.asUser(alice, (q) => q("select * from public.schema_migrations_applied()")))).toBe("42501");
    expect(await errorCode(db.asAnon((q) => q("select * from public.schema_migrations_applied()")))).toBe("42501");
  });
});
