---
bump: minor
---
**Deploy check for unapplied database migrations.** A production build can now fail, and so leave the previous deployment live, when the database is missing a migration the code needs (the cause of the 0.98 sync outage). It only reports until `MIGRATION_CHECK=enforce` is set on Vercel Production, and it never blocks a build because the check itself could not run. Migration `schema_migrations_status` adds the function it reads (service role only). New `pnpm db:status` lists pending migrations and `pnpm db:backfill-sql` records migrations that were applied by hand.
