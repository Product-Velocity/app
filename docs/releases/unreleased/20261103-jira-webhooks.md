---
bump: minor
---
**Jira status updates arrive on their own.** Product Velocity can now register a Jira webhook for each linked project, so the Build Status of a linked initiative follows its Jira issue within seconds instead of waiting for the daily check (which stays as the backstop). A delivery is only a signal: the issue is read again from Jira before anything changes, so repeated, late or forged messages cannot change a status. Reads from Jira also wait and retry when Jira says "too many requests". The webhooks are switched off until the setup has been checked on a real Jira site (migration `jira_webhooks`).
