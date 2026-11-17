---
date: 2026-11-17
by: Ashu, Claude
request: 480
---
**Tracker Status, Flags and Actions columns in the grid, and Jira statuses coloured by category.** Ashu asked (2026-11-17): the platform status of Jira/GitHub as a grid column to split delivery on; the flags and actions of the Changes report as two grid columns, actions clickable; Jira statuses coloured like the internal ones, generically from the mapping.

**Decided**
- **Tracker Status (N49, `tracker_status`)**: a read-only open-list Select, computed by the grid loader, not stored. Jira: the issue's status name. GitHub: the board Status when on a board (same as Delivery Status N33, which stays), else Open / Closed / Closed (not planned). An initiative has one tracker; Jira wins if it somehow has both. In the Delivery default view after Build Status and in Group by's "Most used". Both trackers (parity).
- **Flags (N50) and Actions (N51)**: computed on the row by the controller after every load, add and edit, from the same rules as the Changes report (`flagsOfRow`, `actionsOfFlags`). Not default columns; opt in from the Columns picker. They also hold their words on the row, so sort, search and export see them. Gate-waiting and open-condition flags need gate data the row does not carry, so they stay in Needs attention.
- **Actions** run as the signed-in person through the same `move_phase` as the Roadmap: a move that passes a gate opens the Request gate dialog instead (the database would refuse it). Viewers get no buttons. Claude never approves (rule 3) is unchanged: this is a person's click.
- **Colour of a Jira status = the colour of its status category**, the same mapping Build Status follows (new: grey, in progress: blue, done: green). Source of the category: Jira's own category for the linked issues now, else the Build Status that moved with the change. A status name is never guessed. GitHub: Open blue, Closed green, not planned grey.
- Not synced to either tracker: all three are derived in the app; the tracker mapping table lists Tracker Status as read from the tracker.

**Not done**: a Jira-user column in the grid; gate requests and conditions in the Flags column.

**Same day, later (Ashu):** the Changes report's Follow up column is replaced by the same Flags and Actions columns. **Navigation error:** moving between main pages showed "This page couldn't load" and a reload fixed it. No server error was logged (checked in Vercel runtime errors), so it is a failure in the browser or in the page request right after a release (four deployments in an hour), which a reload fixes. Not reproduced locally (the app needs a sign-in). The error screens (`global-error.tsx`, `(workspace)/error.tsx`) now reload the page once per address and minute, then show Reload, Try again and Back; they log the error to the console. If it still happens, the browser console message is what is needed.

**Navigation error, second round (Ashu: it happens on every switch between main tabs, after signing out and in; switching tabs inside Reports is fine).** So it is not a stale tab. Reproduced against a local production build with a stand-in Supabase (empty data): every main tab and the other workspace pages open by client navigation without an error, so it depends on the real data or the Vercel environment, which cannot be reproduced here (Vercel runtime logs show no server error). The reload notice (`LoadErrorNotice`) now shows what failed (time, address, message, top of the stack) once after the automatic reload; that message is what is needed to fix the cause.
