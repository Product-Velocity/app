---
bump: minor
---
**Connect Jira (issue #67, first part).** Admins can sign in to Atlassian from Settings, Integrations, Jira, see the Jira sites and projects that sign-in reaches, and disconnect. Saved tokens are encrypted and cannot be read by anyone signed in; Atlassian's rotating refresh token is renewed once at a time, and when Atlassian refuses it the page asks for a new sign-in. Linking a project to a Jira project comes next. Migration `20261102214958_jira_connections.sql` (tables `jira_connections` and `jira_credentials`).
