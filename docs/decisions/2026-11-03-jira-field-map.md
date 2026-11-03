---
date: 2026-11-03
by: Ashu (mapping per project), built by Claude
request: 67
---
**The Jira field mapping is per project (issue #67, #70).** A workspace admin chooses, for each linked project on Settings, Integrations, Jira ("Field mapping"), which Jira field holds the start date and which Jira priority stands for each MoSCoW value. Stored in `jira_project_links.field_map` (migration `jira_field_map`), set only by `jira_set_field_map` (a human admin; never Claude, a service account or platform staff; validated in the database; audited).

- **Scope of this slice:** the two fields the write side of Sync already knows how to send. Story points, sprint and team (read-back fields) and the full catalog view stay later. The 170-field dictionary does not grow.
- **Start date:** the choices are the site's custom date fields (the one named Start date first); the system Due date is already sent from G2M Date. **Priority:** the site's priorities; a first proposal is marked "(suggested)" (highest = Must, next = Should, next = Could, lowest = Won't) but never preselected: a person confirms.
- **Unmapped means skipped:** an empty choice is left out of the Sync payload and the preview says so. A stored value that is malformed is dropped before any request (`parseFieldMap`).
- Changing the mapping changes the hash of what is sent, so the next Sync offers to send the newly mapped fields. Saving writes nothing to Jira.
- **Not verified here:** reading `/field` and `/priority` from a real site; whether the chosen start date field is on the issue type's screen (Jira refuses the write and the refusal is shown per initiative).
