---
bump: minor
type: new
---
**New: set a project read only for Jira.** On Settings, Integrations, Jira, Projects each project has "Access to Jira": "Read only: listen to Jira" never writes to Jira (no initiatives are sent, no epic is moved), and the epics you list on an initiative are read with their children, so their status and delivery progress roll up. Switch it to "can write" later; nothing is sent until you press Sync with Jira and confirm. Migration `jira_read_only`.
