---
bump: patch
type: fixed
---
**Fix: live Jira updates come back after you disconnect and reconnect Jira.** After a reconnect, Jira still held the webhook registered before and refused the new one, so the webhook of the project stayed failed and changes made in Jira (for example epics attached by engineering) only arrived at the daily check or on Sync. The daily maintenance now clears the leftover registration (only when it is provably ours and its project link no longer exists) and registers the new one; a failed attempt no longer overwrites the secret of a working webhook.
