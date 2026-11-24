---
bump: minor
type: improved
---
**Jira tab shows the epics you listed with their children and counts; Jira projects show when a row was saved.** On an initiative of a read-only Jira project the Jira tab now says "11 epics · 160 child issues" (and how many are done), lists them with status and links, and the lists scroll inside the panel. On Settings, Integrations, Jira, Projects each row shows "✓ Saved" right after saving and "Last saved" with the date and time.

**Fixed: the grid now reloads after Sync with Jira, and Tracker Status shows epic progress.** After a Sync with nothing to send, the grid and the open Jira tab were not reloaded until you refreshed the whole page, and initiatives that only have listed epics showed "Not linked" in Tracker Status. Closing the Sync window now reloads them, and Tracker Status shows "3 of 11 epics done" for those initiatives.
