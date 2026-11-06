---
issue: 344
status: in progress
logged: 2026-11-06
title: Deploy-time check for unapplied database migrations
---
Ashu: build the deploy-time migration check (follow-up to #330 and #335). Built as `tools/check-migrations.mjs` (Vercel `prebuild`), `public.schema_migrations_applied()`, `pnpm db:status` and `pnpm db:backfill-sql`; see `docs/decisions/2026-11-06-migration-check.md`. To do by Ashu after the PR is merged: apply the `schema_migrations_status` migration, record the hand-applied migrations, then set `MIGRATION_CHECK=enforce` on Vercel Production (steps in `docs/11-ENVIRONMENTS.md`).
