---
date: 2026-11-02
by: Ashu
request: 67
---
**A PV project links to one Jira project and says which of that Jira project's own issue types are the initiative, the epic and the task (issue #67 slice B, #70).** The link is made by a human admin on Settings, Integrations, Jira in two steps: choose the Jira project, then confirm the issue types, which are proposed from that project's types (Epic, or the level above Epic, as in the `docs/16` table). The types are chosen per project because Jira projects differ (the spike's project had no Story). The Jira project and its types are read again from Jira when the link is saved, so the stored ids and names are Jira's.

- A project uses one tracker: a project that uses GitHub cannot be linked until its GitHub links are removed; linking sets `projects.tracker = jira`, unlinking or disconnecting the connection releases it.
- A Jira project backs at most one PV project of a workspace.
- Only software and business Jira projects can be linked for now; Product Discovery ideas are read-only and come with spike J8.
- Statuses are not mapped by name: they are read by status category when Jira is read (slice C). The field mapping from the field catalog (#69, #70) is the next slice.
