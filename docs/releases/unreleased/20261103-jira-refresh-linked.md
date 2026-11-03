---
bump: minor
---
**Initiatives linked to Jira now follow their issue.** When a Jira issue pulled in as an initiative moves to In Progress or Done, its Build Status follows the Jira status category the next time you open Sync (listed under Received, with the Jira status it came from) and in a new daily check. Initiative Status is never set from Jira, and nothing is written to Jira: under To send the dialog says sending to Jira is not built yet. Issues that became Done since the last read no longer linger as open in the new-issues list, and a Jira connection that needs a new sign-in is shown instead of failing silently. Migration `20261103091900_jira_apply_status.sql`.
