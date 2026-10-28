import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Two name styles. Legacy `NNNN_name.sql` (0001 to 0058, frozen: no new ones) and, from issue #238, a UTC timestamp
 * `YYYYMMDDHHMMSS_name.sql` so that two branches can never pick the same number. All legacy names sort before every
 * timestamp name ("0058_..." < "2026..."), so plain string order is the application order.
 */
export const MIGRATION_FILE = /^(?:\d{4}|\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;
export const LEGACY_LAST = 58;
export const isTimestampName = (f) => /^\d{14}_/.test(f);
/** A new migration name for `name` at `now`: `20261028153000_name.sql`. */
export function newMigrationName(name, now = new Date()) {
  const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) throw new Error("Give the migration a name, for example: pnpm db:new add_item_documents");
  const ts = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `${ts}_${slug}.sql`;
}

/**
 * Forward-only migration runner. Applies unapplied `NNNN_name.sql` and `YYYYMMDDHHMMSS_name.sql` files in
 * order, each in one transaction. A previously applied file whose contents
 * changed is an error: never edit applied migrations, add a new one.
 * `client` is a connected `pg` Client.
 */
export async function migrate(client, dir = MIGRATIONS_DIR, log = () => {}) {
  await client.query("create schema if not exists pv_meta");
  await client.query(`create table if not exists pv_meta.schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const { rows } = await client.query(
    "select name, checksum from pv_meta.schema_migrations",
  );
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const files = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f)).sort();

  for (const [name] of applied) {
    if (!files.includes(name)) {
      throw new Error(`Applied migration ${name} is missing from ${dir}`);
    }
  }
  const done = [];
  for (const name of files) {
    const sql = readFileSync(path.join(dir, name), "utf8");
    const checksum = sha(sql);
    const prev = applied.get(name);
    if (prev !== undefined) {
      if (prev !== checksum) {
        throw new Error(
          `Migration ${name} was edited after being applied. Add a new migration instead.`,
        );
      }
      continue;
    }
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into pv_meta.schema_migrations (name, checksum) values ($1, $2)",
        [name, checksum],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Migration ${name} failed: ${e.message}`);
    }
    log(`applied ${name}`);
    done.push(name);
  }
  return done;
}
