---
bump: minor
---
**The Jira settings page now looks and works like the GitHub page.** Status (Test connection, Sign in again, Disconnect), Sync (what happens by itself, Check Jira now, the last check and a table of recent changes with Run again on a failure), the Jira projects, and one Projects table where you choose the tracker, the Jira project and its issue types and press Save (it replaces the two-step Choose and Link). Jira status changes that arrive by webhook or by a check are listed in the table (migration `jira_sync_events`). The GitHub page shows the same "Live updates" line. After Disconnect and a new sign-in, both GitHub and Jira take over the links of the old connection (migration `github_adopt_orphans`).
