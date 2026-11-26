---
bump: patch
type: fixed
---
**Fix: Jira epics no longer stay "Not checked yet" in read-only projects.** On an initiative's Jira tab, an epic that Sync with Jira has already read now shows "Read from Jira" in the Check column instead of "Not checked yet". When Check cannot reach Jira (the connection needs a new sign-in or is missing), it now says so instead of doing nothing.
