---
bump: patch
---
**Groundwork for Jira: a provider-neutral tracker contract (issue #67, first part).** Nothing changes for GitHub users. The code now has a small `TrackerProvider` contract (read an issue and its children, create and update the one issue an initiative owns, assignees, recover a lost create) with GitHub behind it, a contract test every future tracker must pass, and the "no commercial field in any outbound payload" test now runs once per provider. No migration.
