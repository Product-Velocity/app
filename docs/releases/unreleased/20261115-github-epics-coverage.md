---
bump: minor
---
**See which open GitHub epics are linked to initiatives.** New Epics tab on Incoming (GitHub), the same as the Jira one: it lists the open parent issues (issues with sub-issues) of the repositories you tick under Settings, Integrations, GitHub, "Repositories to check for epics", and says for each whether it is linked to an initiative (its own issue, or under a linked parent issue), under a parent issue that is not in Product Velocity, or not linked at all. The tab opens on the ones that need a decision and shows their count. It only reads: nothing is written to GitHub. Adding an epic to an initiative from this list comes with the sub-issues flow (#458). Migration `github_epic_coverage` (two tables and two functions).
