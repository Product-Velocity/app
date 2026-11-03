---
date: 2026-11-03
by: Ashu (instruction 2026-11-03), written by Claude
request: 67
status: agreed
---
**GitHub and Jira (and GitLab later) have parity: the same screens, the same features, built in the same flow.** What is built for one delivery tracker is built for the other in the same piece of work, not "later".

**What must match**
1. **Connection steps and screen.** Same cards in the same order on Settings, Integrations: Status (connected as, Test connection, Sign in again, Disconnect, clear warnings), Sync (what happens automatically, check now, last check, recent events), Projects (one table: project, delivery tracker, tracker project or repository, mapping, Save), then the tracker-specific extras (GitHub boards, Jira field mapping and issues waiting for a decision). The GitHub page is the reference for layout and wording; the Jira page is rebuilt to it.
2. **Connection information and configuration.** The same facts are shown and the same things are set in the same place (what is connected, what it can reach, defaults per project, who breaks down the work, read-only access where the tracker allows it).
3. **Sync actions and rules.** Received, Conflicts, To send and confirm in the same dialog; automated updates (webhooks) plus a daily check plus the manual "Check now" and Sync as the fallback; the same boundaries (commercial fields never leave, Initiative Status never set by the tracker, nothing written before confirmation, rule 6 exceptions only as recorded).
4. **Features.** A feature developed for one (for example deleting an initiative closes or labels its tracker issue, removed-in-Product-Velocity handling, children and roll-up, activity log, repair after a new sign-in) is built for the other in the same flow, with the same wording in the app, the Help page and the release note.

**How it is applied**
- Before building, check the other tracker for the same feature; the issue and the PR description have a "Parity" line: built for both, or the exception with its reason and a linked issue. Reviewing a PR that has a feature for one tracker and no Parity line is a stop.
- A real difference in the tracker (for example GitHub Projects boards, Jira Product Discovery ideas, Jira status categories) is allowed when the tracker has no equivalent; the screen then shows the same card with "Not available for <tracker>" rather than leaving it out, and the difference is written in `docs/04` or `docs/16`.
- Shared code goes behind the tracker interface (issue #67) whenever it is more than presentation, so both behave the same by construction.

**Known gaps at the time of writing (to close, in this order):** (a) Jira page rebuilt to the GitHub layout, with Test connection and recent events; (b) automated updates and the daily check described the same way on both pages; (c) check what GitHub does when an initiative is deleted against the Jira "label and close" behaviour (decision 2026-11-03-jira-close-removed) and align them; (d) the same recovery for GitHub after signing in again (Jira repair: `jira_adopt_orphans`).
