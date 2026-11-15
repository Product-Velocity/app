---
bump: minor
---
**See which open Jira epics are linked to initiatives.** New Epics tab on Incoming (Jira): it lists the open epics of the Jira projects you tick under Settings, Integrations, Jira, "Projects to check for epics", and says for each whether it is linked to an initiative (its own issue, under a linked Jira Initiative, or waiting for Sync), under a Jira Initiative that is not in Product Velocity, or not linked at all. The tab opens on the epics that need a decision and shows their count. "List on initiative" adds the epic to an initiative, and Jira changes only after the preview and your confirmation in Sync with Jira. Migration `jira_epic_coverage` (two tables and two functions).
