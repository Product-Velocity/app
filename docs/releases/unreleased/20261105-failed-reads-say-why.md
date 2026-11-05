---
bump: patch
---
**A sync that cannot read the database now says why.** When a database update is missing, Sync with Jira showed "Could not check" with "Jira could not be read just now" for every linked initiative, and the GitHub side showed "Not on GitHub", ignored issue events and checked nothing, with no message at all. Both now report that the database is missing an update (with the error code) in the sync dialog, the Jira and GitHub sync logs and the webhook log, and nothing is changed. The migration `tracker_freeze` (0.98) still has to be applied to the project for the sync to work again.
