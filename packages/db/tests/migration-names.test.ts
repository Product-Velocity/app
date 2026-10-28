import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { isTimestampName, LEGACY_LAST, MIGRATION_FILE, MIGRATIONS_DIR, newMigrationName } from "../src/migrate.mjs";

// Issue #238: migrations are named by UTC timestamp so two branches can never pick the same number. The legacy 0001 to 0058 set is frozen.
const files: string[] = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const legacy = files.filter((f) => !isTimestampName(f));
const stamped = files.filter(isTimestampName);

describe("migration file names", () => {
  it("every file follows one of the two styles", () => {
    expect(files.filter((f) => !MIGRATION_FILE.test(f))).toEqual([]);
  });

  it("the legacy numbered set is frozen at 0058: a new migration with a four-digit number is refused", () => {
    expect(legacy.length).toBeGreaterThan(50);
    for (const f of legacy) expect(Number(f.slice(0, 4)), f).toBeLessThanOrEqual(LEGACY_LAST);
  });

  it("timestamp names are real UTC dates from 2026 on, and no two share a timestamp", () => {
    const stamps = stamped.map((f) => f.slice(0, 14));
    expect(new Set(stamps).size).toBe(stamps.length);
    for (const s of stamps) {
      const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`);
      expect(Number.isNaN(d.getTime()), s).toBe(false);
      expect(d.toISOString().replace(/\D/g, "").slice(0, 14), s).toBe(s);
      expect(d.getUTCFullYear(), s).toBeGreaterThanOrEqual(2026);
    }
  });

  it("plain string order applies every legacy migration before any timestamped one", () => {
    expect(files).toEqual([...legacy, ...stamped]);
  });
});

describe("newMigrationName", () => {
  it("makes a UTC timestamp and a safe snake_case name", () => {
    expect(newMigrationName("Add item documents!", new Date("2026-10-28T15:30:05Z"))).toBe("20261028153005_add_item_documents.sql");
    expect(MIGRATION_FILE.test(newMigrationName("x y  z", new Date()))).toBe(true);
  });
  it("sorts after every legacy name and in time order", () => {
    const a = newMigrationName("a", new Date("2026-10-28T10:00:00Z"));
    const b = newMigrationName("b", new Date("2026-10-29T09:00:00Z"));
    expect(["0058_x.sql", b, a].sort()).toEqual(["0058_x.sql", a, b]);
  });
  it("refuses an empty name", () => {
    expect(() => newMigrationName("  ")).toThrow(/name/);
  });
});
