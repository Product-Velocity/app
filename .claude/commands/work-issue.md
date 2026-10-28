---
description: Pick up a GitHub issue and implement it end to end following the Product Velocity rules
argument-hint: <issue-number>
---

Work on GitHub issue #$ARGUMENTS in this repository.

1. Read the issue (`gh issue view $ARGUMENTS`), then CLAUDE.md, and the docs it references (PRD section, data model, sync/AI docs, prototype boards via docs/07-PROTOTYPE-MAP.md). If the issue depends on an unfinished spike (docs/08) or earlier phase, stop and say so.
2. If anything in the issue, the docs and the prototype disagree, or the acceptance criteria are untestable, stop and ask Ashu. Otherwise record any decision you make as a file in docs/decisions/ (docs/decisions/README.md).
3. Claim the issue first (docs/23-PARALLEL-WORK.md: assign it, check open PRs for the same files and SQL functions). Create a branch `issue-$ARGUMENTS-<short-slug>`. Plan briefly (files, migrations, tests) in your first message, then implement in small commits.
4. Write tests first for domain logic. For every new or changed table add a migration and two-tenant RLS tests. Add audit logging for all writes. Keep commercial fields out of any GitHub payload and customer-safe output.
5. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm db:test`. Fix failures; do not skip or weaken tests.
6. For UI changes, run the app, exercise the keyboard path and the main flow, and attach screenshots.
7. Update docs that changed behaviour, and add a release fragment (docs/releases/unreleased/README.md) instead of bumping the version. Open a PR that links the issue, lists each acceptance criterion with how it was verified, notes any deviation, and calls out risks. Do not merge.
8. Final message: what changed, what was verified, what is left or uncertain. Never claim a criterion passes without having run it.
