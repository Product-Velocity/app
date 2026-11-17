---
bump: minor
---
**Changes report: one row per Jira or GitHub move, and who moved the Jira issue.** A move of a linked issue used to show as two rows (the status of the issue and Build Status); it is now one row with the Build Status under it, so R-72's four Jira moves are four rows, not eight. A new Jira user column names who moved the Jira issue to that status, read from Jira's own history (the daily check also fills in past changes the first time it reads an issue). The name is shown on a row only, can be searched, and is never counted or grouped per person. New table `jira_status_changes` (migration 20261117161305_jira_status_changes.sql).
