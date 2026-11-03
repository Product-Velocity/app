---
bump: patch
---
**Signing in to Jira again after a Disconnect keeps your project link.** Disconnecting keeps the link of a project whose initiatives follow Jira issues, but a new sign-in created a new connection and the old link stayed on the disconnected one, so Read Jira and the daily check found nothing ("That Jira connection or site is not available"). A new sign-in now takes over the links, the linked initiatives and the issue list of the same Jira site; migration `jira_adopt_orphans` also repairs workspaces already in this state.
