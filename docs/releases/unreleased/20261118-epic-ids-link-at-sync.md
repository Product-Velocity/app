---
bump: minor
---
**Jira epic IDs link at Sync without asking again, and Claude can list them.** List the epic keys on an initiative (or ask Claude: "put R8P-1234 under R-12") and the next Sync with Jira sets each epic's parent when it has none; an epic that would move from another parent is still shown for you to confirm. Claude has a new tool, request_jira_epics, which only records the keys. Jira only for now; GitHub follows with issue #458.
