---
date: 2026-11-02
by: Ashu
request: 253
---
**Pulling Jira issues in (issue #67 slice C2a, #76, #256).** On the Jira settings page, under a linked project, creators and admins see the issues read from Jira that nobody has decided on, select some and choose **Pull in** (read only, the default, or **Product Velocity takes ownership**) or **Ignore**; ignored issues can be shown and brought back. This is the Jira twin of "what comes in" for GitHub; moving it into the "new items" step of Sync is C2b.

- A pulled-in issue becomes an initiative of the linked project with source "Jira issue KEY". The link lives in `item_jira_links` (Jira's own table; mode `follow` or `push`). An initiative has one tracker: a GitHub-linked initiative cannot get a Jira link, and an issue can only be pulled into the project that is linked to its Jira project.
- **Build Status** follows the Jira status category at pull-in (to do = Not started, in progress = In progress, done = Done) and stays read only; **Initiative Status is never set from Jira** (rule 6). Taking ownership writes nothing to Jira; edits go out later through Sync after a preview.
- A project with Jira-linked initiatives cannot be unlinked until they are removed; disconnecting Jira keeps such a project's link and tracker and releases the others (with their unpulled issue lists), so initiatives stay consistent.
- Not in this slice: the read-side refresh of linked initiatives (status changes in Jira), writing to Jira, rules for new arrivals, and the Sync dialog.
