---
date: 2026-11-11
by: Ashu ("update your instructions to allow for PR and merge automatically when a task is done"), written by Claude
status: built
---
**Claude opens the pull request and lets it merge when a task is done, without asking each time.** Until now a PR was opened only on request and merged by Ashu, which left finished work waiting.

- **Where.** `CLAUDE.md`, Working agreements ("Finishing a task"). It overrides the default of not opening a PR unless asked.
- **How a merge happens.** Push the branch, open the PR from the template, subscribe to its activity, enable auto-merge: GitHub merges it through the merge queue only when the required checks pass.
- **Limits.** No merging around red, skipped or missing checks; no weakened tests; no force-push or merge of someone else's branch; only PRs Claude opened. Anything that changes scope, cannot be undone, adds a costly dependency or conflicts with the docs still goes to Ashu first.
- **Migrations.** Apply to production first (an approval prompt for Ashu), then tick "Migration applied to production" (see `2026-11-11-migration-gate.md`).
- **Rule 3 is unchanged.** Claude still never approves a decision gate or holds the Approver permission; that rule is about the product, not pull requests.
