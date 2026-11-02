---
date: 2026-11-02
by: Ashu
request: 253
---
**New Jira issues are decided on inside Sync (issue #67 slice C2b, #256).** When the initiatives chosen for a sync belong to a project that uses Jira, the dialog opens with "Sync with Jira: new issues first": it reads the open issues of the linked Jira projects, then shows the same list as for GitHub (filters, select, Pull in read only or owned by Product Velocity, Ignore, Undo), with Jira's words (issue keys such as PLAT-12, the Jira project as the group). A selection that spans both trackers shows the GitHub step and then the Jira step. A person only sees the step of the trackers their selection belongs to, found by the router's own `trackerOf`.

- One list, two data sources: Jira's light records are mapped into the list's shape in `supabase-jira-source.ts`; GitHub's data layer is unchanged.
- Each Jira issue goes into the project linked to its own Jira project (a person cannot send it to the wrong project); the project choice is therefore not shown.
- Saved rules for new arrivals do not exist for Jira yet, so that section is hidden.
- The second step (compare and send) still ends with "Syncing with Jira is not available yet" for a Jira project, because Jira has no sync engine yet: the router says so before anything is written. Refreshing linked initiatives from Jira and writing to Jira are next.
