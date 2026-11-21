---
issue: 559
status: done
done: 2026-11-21
link: PR #560
logged: 2026-11-21
title: Public read-only demo: "See the demo" button into Meridian Media
---
Ashu (2026-11-21): "I want to use the meridian setup to become a demo for prospects of the tool. I want to put a see the demo button on the website. When you click it you go immediately into the account and user can click around. It needs to be read/view only. No option to move an item or save updates or decide anything. No option to connect Claude or Jira or anything. No option to pull in data or export data. Just the meridian project with the grids, reports, etc. We also need to populate some more data into the meridian project, like some outcome metrics and dates to make the gantt work."

Confirmed with Ashu: a fixed demo login (role viewer) already a member of the real Meridian Media tenant, not a separate mirrored UI; Meridian's existing data can be shown as-is; demo nav covers the roadmap grid + peek panel, Reports, Gantt, Leadership and Cards.

Decision: `docs/15-ACCOUNTS-AND-ADMIN.md` section 5b. Migration: `packages/db/migrations/20261121084429_demo_viewer_account.sql`.
