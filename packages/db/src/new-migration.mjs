// pnpm db:new <name>: creates packages/db/migrations/<UTC timestamp>_<name>.sql with a header, so two agents never pick the same number.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS_DIR, newMigrationName } from "./migrate.mjs";

let file;
try {
  file = newMigrationName(process.argv.slice(2).join(" "));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const target = path.join(MIGRATIONS_DIR, file);
if (existsSync(target)) {
  console.error(`${file} already exists; try again in a second.`);
  process.exit(1);
}
writeFileSync(
  target,
  `-- ${file.replace(/\.sql$/, "")}: <what this changes and why; the request or issue number>\n-- Forward-only. Never edit this file after it is applied; add a new migration instead.\n-- New tables: RLS with the fast policy pattern, an index starting with tenant_id, and a probe in packages/db/tests/rls.test.ts.\n-- If you replace a whole function (create or replace), say which, and check no open branch changes it too (docs/23-PARALLEL-WORK.md).\n\n`,
);
console.log(`Created packages/db/migrations/${file}`);
