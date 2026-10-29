---
bump: patch
---
**Atlassian connection test page for admins (spike J1, issue #257).** A throwaway admin page at `/spikes/atlassian` connects once to a Jira site with OAuth 2.0 and shows what Atlassian answers (sites, projects, issue types, fields). It asks only for the Jira read and write scopes plus a refresh token, stores nothing and shows no token. Needs the `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` and `ATLASSIAN_REDIRECT_URI` variables. No migration.
