---
date: 2026-11-09
by: Ashu (instruction 2026-11-09, option 1), written by Claude
request: 364
status: built
---
**Pulling a GitHub issue in keeps the issue's text once, as the initiative's Description.**

**Why.** Ashu pulled four issues into EARO and every Description was empty: pull-in worked from the Incoming "light record" (title, type, labels, state, link) and, by design, never read bodies (`docs/04`, Incoming). That left an initiative with a title and nothing else.

**The rules**
- Only at the moment a person clicks Pull in, only for the issues just pulled in. The Incoming list, the daily check and the webhooks still never read bodies.
- The body is stored as the **Description** (Markdown, cut at 20,000 characters, our markers and @mentions neutralised as for every text read from GitHub). It is a **snapshot**: never refreshed from GitHub and never written back on its own. For a Product Velocity owned (push) link the usual three-way Sync applies from then on.
- Only while the Description is empty (the database function `github_copy_issue_description` refuses to replace text a person wrote), only for initiatives with source "GitHub issue #N" and a GitHub link (either mode), only by a creator or admin who is a person; audited as that person; undo of the pull-in removes the initiative with it.
- A body that holds a Product Velocity block is not skipped (changed 2026-11-09 after EARO's Descriptions stayed empty): the block is cut out and the text around it is kept, or the block's own Description if nothing else is there. A body with no text leaves the Description empty and Re-pull reports it. An unreadable issue leaves the Description empty; the Incoming message says so; the pull-in is never undone for it.
- **The text is data** (CLAUDE.md rule 4): stored as text, never interpreted. It may contain commercial or customer wording; it goes into Product Velocity only, never back to GitHub unless the person owns the issue and syncs it, and then only as the existing Description section of the managed block (the allowlist and its test are unchanged).
- **Known consequence for "Product Velocity owns it":** the first send adds the managed block (with this Description) at the end of the issue and keeps the original text above it, so the text appears twice in that issue. Read only pull-ins are not affected. Whether the first send should replace the original body is a separate decision (it would remove text from GitHub), not made here.

**Parity.** Built for Jira too (issue #365): the same rules with the Atlassian document converter `adfToMarkdown`, `jira_copy_issue_description` and `descriptionFromJiraAdf` (a description Product Velocity wrote uses its Description section).

**Same change set:** a "managed block missing" conflict is no longer raised for an issue Product Velocity never wrote to (`docs/21`).
