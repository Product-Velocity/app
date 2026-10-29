---
bump: patch
---
**Groundwork for Jira: the Sync dialog now goes through a thin router (issue #67, first part).** Nothing changes for GitHub users: GitHub's sync is untouched. The Sync with GitHub dialog calls one entry point that sends each initiative to the sync engine of its project's tracker, so Jira can get a dedicated engine of its own later. A selection that includes a tracker without an engine is refused before anything is written. The "no commercial field in any outbound payload" test now runs once per provider. No migration.
