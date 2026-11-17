// Run by .github/workflows/migration-gate.yml on every PR. A PR that adds a database migration must say, in its description, that the
// migration is applied to production, because the deploy-time check (tools/check-migrations.mjs, issue #344) refuses to deploy
// code whose migration is missing there, which leaves production on the old version until someone applies it.
// Input: ADDED_FILES (newline-separated paths of files the PR adds under packages/db/migrations/) and PR_BODY.

export const CHECKED = /^\s*[-*]\s*\[[xX]\]\s*Migration(?:s)? applied to production/m;
export const NOT_NEEDED = /^\s*[-*]\s*\[[xX]\]\s*No migration in this PR/m;

export function checkMigrationGate(addedFiles, body) {
  const migrations = addedFiles.filter((f) => /^packages\/db\/migrations\/[^/]+\.sql$/.test(f));
  if (migrations.length === 0) return { ok: true, migrations, message: "No new migration in this PR." };
  if (CHECKED.test(body ?? "")) return { ok: true, migrations, message: `Migration applied to production, as ticked: ${migrations.join(", ")}` };
  return {
    ok: false,
    migrations,
    message: [
      "This PR adds a database migration:",
      ...migrations.map((m) => `  - ${m}`),
      "Merging it before it is applied to production makes every production deploy fail at the migration check (production stays on the old version).",
      "Apply it (docs/11-ENVIRONMENTS.md: `pnpm db:migrate` with the production DATABASE_URL, or ask Claude), then tick",
      "  - [x] Migration applied to production",
      "in the PR description. This check runs again when the description is edited.",
    ].join("\n"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const added = (process.env.ADDED_FILES ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const r = checkMigrationGate(added, process.env.PR_BODY ?? "");
  console[r.ok ? "log" : "error"](r.message);
  process.exit(r.ok ? 0 : 1);
}
