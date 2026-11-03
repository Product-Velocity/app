---
bump: patch
---
**Jira projects stay linked on the settings page, and Jira initiatives show their ticket.** A database that did not have the new field-mapping column yet made the project link unreadable, so the page always asked to "Choose a Jira project" and Sync said "Not in Jira yet" for everything; the field mapping is now read apart, so a missing column only leaves the mapping empty. The grid's Synced With column now shows the Jira ticket (for example "Jira · SCRUM-2 · follows it, read-only"), Tracker Ownership shows who owns it, and Last Synced shows the last sync of an initiative linked to Jira.
