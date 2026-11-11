---
bump: patch
---
**Migration gate for pull requests.** A pull request that adds a database migration now fails a check until its description says the migration is applied to production, so a merge can no longer leave production deploys failing at the migration check. Developer tooling only; nothing changes in the app.
