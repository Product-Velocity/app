---
bump: minor
---
**Pulling in a GitHub issue now keeps its text as the initiative's Description.** When you click Pull in, the issue body is read once and stored in the Description (only while it is empty, cut at 20,000 characters, never refreshed or sent back by itself). The Incoming list still reads no bodies, and an issue that cannot be read leaves the Description empty with a note. Migration `20261109110452_github_copy_issue_description`. Jira follows in a later release.
