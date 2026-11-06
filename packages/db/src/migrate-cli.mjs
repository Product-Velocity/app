import pg from "pg";
import { migrate } from "./migrate.mjs";
import { backfillSql, compareMigrations, listMigrationFiles } from "./pending.mjs";

const arg = process.argv[2];
// pnpm db:backfill-sql: prints SQL that records every migration file as applied (no database needed); see docs/11-ENVIRONMENTS.md
if (arg === "--backfill-sql") {
  process.stdout.write(backfillSql(listMigrationFiles()));
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (Supabase: Project Settings > Database > Connection string, direct or session pooler).");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (arg === "--status") {
    const { rows } = await client.query("select name, checksum from pv_meta.schema_migrations");
    const { pending, edited } = compareMigrations(listMigrationFiles(), rows);
    for (const n of pending) console.log(`pending ${n}`);
    for (const n of edited) console.log(`edited  ${n}`);
    console.log(pending.length || edited.length ? `${pending.length} pending, ${edited.length} edited.` : "Up to date.");
    process.exitCode = pending.length || edited.length ? 1 : 0;
  } else {
  const done = await migrate(client, undefined, (m) => console.log(m));
  console.log(done.length ? `Done: ${done.length} applied.` : "Up to date.");
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
