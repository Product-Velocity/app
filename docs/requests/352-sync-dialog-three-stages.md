---
issue: 352
status: in progress
logged: 2026-11-06
title: Sync dialog in three stages and a Cancel button
---
Ashu: the Sync result should show details. The flow on the sync screen: (1) updates from Jira/GitHub that need to come back to Product Velocity; (2) the issues one by one with updates to send from Product Velocity to Jira/GitHub, split by filters; (3) the issues confirmed as synced with the updates in both directions; (4) a Cancel button is missing on the first sync screen.

Built as described in `docs/21-SYNC-WITH-GITHUB.md` ("The dialog in three stages"); both trackers. Choices made: stage 1 holds what came in plus conflicts and check problems (the new-issues step stays first); filters in stage 2 are All / To send / Nothing to send / Deletions; stage 3 lists, per initiative, what came in, how conflicts were settled and what was written (from the result, not read back).
