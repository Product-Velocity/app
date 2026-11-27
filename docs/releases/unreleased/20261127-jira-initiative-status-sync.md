---
bump: minor
type: new
---
**New: set the Jira workflow status from the Initiative Status.** In Settings, Integrations, Jira, Field mapping, the new card **Initiative Status in Jira** lets an admin switch on, per project, setting the Jira status of an initiative's issue from its Initiative Status (Backlog, Active, On hold, Completed, Cancelled), with one Jira status chosen for each (a same-name status is suggested). It is off by default and one way. Sync with Jira shows each move first ("Move the status from Backlog to WIP Research") and only moves the issue after you confirm, with the workflow's own transition; when the workflow does not allow it, the status stays and Sync says why. It only touches the issue that is the initiative, never epics, stories or tasks, and never Build Status, which keeps following the epics. Needs the migration `jira_status_sync`.
