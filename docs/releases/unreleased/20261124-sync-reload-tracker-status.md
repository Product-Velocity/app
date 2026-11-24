---
bump: minor
type: fixed
---
**Fixed: the grid now reloads after Sync with Jira, and Tracker Status shows epic progress.** After a Sync with nothing to send, the grid and the open Jira tab were not reloaded until you refreshed the whole page, and initiatives that only have listed epics showed "Not linked" in Tracker Status. Closing the Sync window now reloads them, and Tracker Status shows "3 of 11 epics done" for those initiatives.
