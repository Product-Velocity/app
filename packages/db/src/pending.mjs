import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATION_FILE, MIGRATIONS_DIR } from "./migrate.mjs";

// What the deployed code expects (the migration files in the repo) against what the database has recorded (pv_meta.schema_migrations).
// Pure functions, shared by `pnpm db:status`, `pnpm db:backfill-sql` and the deploy-time check (tools/check-migrations.mjs). Issue #344.

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** The migration files of the repo, in application order, with the checksum `migrate.mjs` records. */
export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort()
    .map((name) => ({ name, checksum: sha(readFileSync(path.join(dir, name), "utf8")) }));
}

/**
 * `files` and `applied` are lists of { name, checksum }.
 * pending: in the repo, not recorded as applied. edited: recorded with another checksum (a file changed after it was applied).
 * unknown: recorded but no longer in the repo.
 */
export function compareMigrations(files, applied) {
  const done = new Map(applied.map((a) => [a.name, a.checksum]));
  const have = new Set(files.map((f) => f.name));
  return {
    pending: files.filter((f) => !done.has(f.name)).map((f) => f.name),
    edited: files.filter((f) => done.has(f.name) && done.get(f.name) !== f.checksum).map((f) => f.name),
    unknown: applied.filter((a) => !have.has(a.name)).map((a) => a.name),
  };
}

/** Idempotent SQL that records files as applied WITHOUT running them (for migrations applied by hand in the SQL editor). */
export function backfillSql(files) {
  const rows = files.map((f) => `  ('${f.name}', '${f.checksum}')`).join(",\n");
  return [
    "-- Records these migration files as applied in pv_meta.schema_migrations. It does NOT run them.",
    "-- Only paste this after checking that every one of them is really applied: it hides a missing migration from the deploy check.",
    "insert into pv_meta.schema_migrations (name, checksum) values",
    rows,
    "on conflict (name) do nothing;",
    "",
  ].join("\n");
}
