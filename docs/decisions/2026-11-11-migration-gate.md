---
date: 2026-11-11
by: Ashu (asked for option 1), built by Claude
status: built
---
**A PR that adds a migration cannot merge until its description says the migration is applied to production.** Production deploys of v0.137.0, v0.138.0 and the merges of #412 and #415 failed at the deploy-time migration check (#344) because `20261111170015_stealth_label_names.sql` was merged but not applied, so production stayed on v0.136.2. The check did its job; the gap was that nothing told the author to apply the migration first.

- **Check.** `.github/workflows/migration-gate.yml` runs `tools/check-pr-migrations.mjs` on every PR (and again when the description is edited). It fails when the PR adds a file under `packages/db/migrations/` and the description lacks the ticked line `- [x] Migration applied to production`. Nothing else changes for PRs without a migration.
- **PR template.** `.github/pull_request_template.md` carries that line and its opposite (`No migration in this PR`).
- **To make it block merging:** mark "Migration gate / migration-gate" as a required status check in the branch protection or ruleset of `main` (a repository setting, not code). Until then it reports but does not block.
- **Not done (option 2, Ashu's call later):** applying migrations automatically on merge. It needs a production database URL as a secret and removes the human step.
