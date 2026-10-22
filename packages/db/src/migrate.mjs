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
 * Forward-only migration runner. Applies unapplied `NNNN_name.sql` files in
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
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

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
