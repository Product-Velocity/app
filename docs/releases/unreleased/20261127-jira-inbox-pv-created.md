---
bump: patch
type: fixed
---
**Fix: an issue Product Velocity created in Jira is no longer offered as new in the Jira inbox.** After a Sync created the Jira issue of an initiative, the next read listed it under "Not pulled". It is now known as the initiative's own issue (and keeps syncing), and the one that was already showing is repaired (migration `jira_pv_issues_are_pulled`).
