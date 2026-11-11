---
bump: patch
---
**Jira children no longer disappear silently.** When the full read of a Jira issue's children fails, the Sync with Jira dialog now says so on that initiative's card (and the reason is logged), and the Jira tab shows the children already known from the project's issue list, with a note that the full read did not complete. No migration.
