---
issue: 330
status: in progress
logged: 2026-11-05
title: Delivery sync shows "Could not check" for every linked initiative since 0.98
---
Ashu: the delivery sync link seems broken in release 0.97 and later. In the Jira sync list every linked initiative shows "Could not check" / "Jira could not be read just now. Try again in a minute."; Try again does not help. Check the GitHub side too.

Found: 0.98 (tracker freeze, migration `20261105164327_tracker_freeze.sql`) is not applied on Provelo, and every tracker read filters on its `frozen_at` column. Reads that fail now say so (database missing an update, with the Postgres code) in the dialog, the sync log and the webhook log, for Jira and GitHub. To do by Ashu: apply the pending migrations to Provelo (see `docs/11-ENVIRONMENTS.md`).
