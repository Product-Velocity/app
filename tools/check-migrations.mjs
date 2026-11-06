// Run by `prebuild` in apps/web (issue #344). The logic is in packages/db/src/check.mjs; this file only wires the repo's migration files.
import { runCheck } from "../packages/db/src/check.mjs";
import { listMigrationFiles } from "../packages/db/src/pending.mjs";

const { exit, lines } = await runCheck({ env: process.env, files: listMigrationFiles() });
for (const l of lines) console[exit ? "error" : "log"](l);
process.exit(exit);
