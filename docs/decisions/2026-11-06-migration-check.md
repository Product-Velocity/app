---
date: 2026-11-06
by: Ashu (2026-11-06, "build the deploy-time migration check"), built by Claude
request: 344
status: built, to confirm
---
**A production build fails when the database is missing a migration the code needs (issue #344).**

- **Why.** On 2026-11-05 the live database lacked three migrations the deployed code needed (every Jira and GitHub read failed, #330), and applying them made a PostgREST embed ambiguous (#335). Applying migrations by hand in the SQL editor is the normal way here, so the guard has to sit at deploy, not in people's memory.
- **How.** `apps/web` runs `tools/check-migrations.mjs` as `prebuild`. It lists the migration files of the repo (name and sha256, the same checksum `migrate.mjs` records) and reads `public.schema_migrations_applied()` over HTTPS with the Supabase URL and service-role key the app already has. In `enforce` mode it fails the build when a migration is pending or an applied file was edited. A failed production build leaves the previous deployment live, so code that needs an unapplied migration never replaces code that works.
- **It never blocks because the check itself is broken.** No credentials, network error, HTTP error, an unexpected answer, or the function not existing yet: it prints why it skipped and the build continues, in every mode.
- **Modes.** `MIGRATION_CHECK=warn` (default: report only), `enforce` (fail), `off`. Previews stay on `warn`: a PR that adds a migration always has a preview whose database is still behind. Ashu sets `enforce` on Vercel **Production** only, after the steps in `docs/11-ENVIRONMENTS.md` (apply `schema_migrations_status`, record the hand-applied migrations).
- **Tools.** `pnpm db:status` (needs `DATABASE_URL`) lists pending and edited migrations. `pnpm db:backfill-sql` prints idempotent SQL that records every file as applied without running it, for migrations applied by hand; it hides a missing migration from the check, so it is pasted only after the schema was compared.
- **Safety.** The function exposes only names and hashes of our own migration files, to `service_role` only (a test refuses `authenticated` and `anon`). The check never prints the key, the URL or row data.
- **Not done.** The check does not run migrations (applying stays a person's decision) and does not look inside the schema: it trusts `pv_meta.schema_migrations`.
