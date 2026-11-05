---
bump: minor
---
**Documents go to GitHub and Jira, unless you say not to.** Written documents (the PRD, discovery, research and the rest) are now sent with the next Sync as a last section, "Documents", of the GitHub issue and the Jira description, to private repositories only. Each document can be set to "Do not share" to keep it in Product Velocity. Migration `20261105214922_document_shared_with_trackers.sql` adds the switch (apply it before this version is deployed; every existing document then counts as shared). The rule in CLAUDE.md is changed to match.
