---
bump: minor
---
**Sync with Jira can close the issue of an initiative you deleted.** A new section, "Removed in Product Velocity", lists initiatives in the Trash whose Jira issue Product Velocity owns. For each one you see what will happen, then confirm: the issue gets the label pv:removed and is moved to a Done status (you choose when the workflow has several; the choice is remembered per Jira project). Jira's refusal is shown per initiative with Try again. Issues that came from Jira are never touched, nothing is deleted in Jira, and Initiative Status is unchanged. Restoring an initiative does not reopen its issue. Needs the migration jira_close_removed; until it is applied the section stays hidden.
