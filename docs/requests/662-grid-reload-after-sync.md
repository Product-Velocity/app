---
issue: 662
status: done
done: 2026-11-24
link: PR #664
logged: 2026-11-24
title: Grid and panels reload after Sync; Tracker Status for initiatives with listed epics
---
Ashu, after syncing all initiatives with a read-only Jira project: the grid stayed stale until a full page reload, and Tracker Status stayed "Not linked". Built in PR #664: Done/Cancel/Escape after a Sync preview reload the grid and open panels; Tracker Status shows "x of n epics done". See `docs/decisions/2026-11-24-jira-read-only-mode.md`.
