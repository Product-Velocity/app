---
bump: minor
---
**Sync with GitHub reads GitHub for new issues before it lists them (issue #272).** The first step used to show only what the webhooks and the daily check had already recorded, so an issue created a minute ago could be missing. It now asks GitHub, for each repository, only for what changed since the last full check (one small request when nothing did), then shows the list. It waits at most 8 seconds: if GitHub is slow or cannot be read, the step shows what it already has and the sync goes on. Nothing is written to GitHub. No migration.
