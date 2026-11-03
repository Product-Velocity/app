---
bump: minor
---
**Jira children now belong to their initiative.** The features, tasks and sub-tasks under the Jira issue an initiative is linked to are read into the initiative's Jira tab (read only: key, title, type, status, assignee) and counted into Issues Total, Issues Closed and Delivery Progress %, like the epics and tasks of GitHub. They are no longer offered as new items in Sync or on the Jira settings page. A done child is progress, never a done initiative. Needs the migration `jira_sub_items` (applied by hand); until then everything keeps working without the lists.
