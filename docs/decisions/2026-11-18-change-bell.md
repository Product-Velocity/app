---
date: 2026-11-18
by: Ashu, Claude
request: 502
---
**The top-bar bell also counts changes per project, in every account the person can open; the change log it leads to is the Changes report.** Ashu asked for it on 2026-11-18. The bell keeps the decision-gate inbox (issue #341) in the same panel, under the changes.

What it does: a pill on the bell with the sum (exact up to 99, then "99+"; the accessible name has the words: "Notifications, 9 new: 7 changes, 2 unread"). The panel lists each project with changes (project name, its account, the count and a line per type: Phase, Status, Health, Build status, Linked issue), newest first. **Clear counts** resets every counter to 0. A click on a project opens `/w/{account}/reports?report=changes&scope=p:{project}` (another account is a full page load, like the account switcher) and clears that project's counter. It reads again every minute and when the tab comes back, like the inbox.

How it counts: the database function `change_counts()` counts the same audit rows as the Changes report (`change_feed`: the same five kinds, no commercial field, no gate decision), per account, project and type, newer than the person's mark in `change_watch_clears` (one row per person and project; migration `20261118133107_change_watch.sql`). Account and project come from the initiative's home project; trashed initiatives are left out; a window of 90 days bounds the scan. `clear_change_counts(tenant, project)` resets one project, one account or all; a person only (`PV004` for Claude).

Choices made without asking, change them if you disagree:
1. **The pill, not a dot:** a number says more and has words for screen readers (the UX bar).
2. **A project seen for the first time starts at zero** (no flood of old changes the first time the bell opens); a project created later starts counting at the next read.
3. **Your own changes are not counted;** the bell is for what others and the trackers did. Sync runs by a tracker count.
4. **Opening a project clears only that project;** the log itself still shows the whole period, so nothing is lost.
5. **One pill for changes plus unread decision notices;** each part has its own header in the panel.
6. **Polling, not live push,** the same as the inbox; "as changes come in" means within a minute. Live push through Supabase Realtime is possible later.
7. **Counts are per project and type only,** never per person (rule 8). The marks are personal reading state like `notifications.read_at`: not audited, written only through the two functions.
8. **Tracker parity:** the Linked issue type covers GitHub and Jira together.
