---
date: 2026-11-03
by: Claude (proposal, to confirm with Ashu)
request: 67
status: proposed
---
**Plan for writing to Jira from Sync (issues #67, #71).** Proposal, not yet agreed; the four decisions below go to Ashu with a recommendation each.

1. **What is sent for an initiative in "push" mode.** Recommended first set: **name (summary), description, labels** (`pv:*` labels only, same namespace rule as GitHub: add the ones that apply, remove the `pv:` ones that no longer apply, never touch labels people added). Later, one step each: parent link, dates (needs the field catalog, #69/#70), priority and MoSCoW (label first, custom field after mapping), Initiative Group. Never: any status, transition, or commercial field.
2. **Creating issues.** Recommended: Sync **creates the initiative's issue** (type chosen in `jira_project_links`) for an initiative of a Jira-linked project without a link, shown under To send as "Not in Jira yet: will be created", like GitHub's tracking issue. Sync does **not** create epics or tasks: GitHub decided on 2026-10-26 that breakdown lives in the tracker, and docs/16 says the same for Jira.
3. **Description.** A small tested Markdown-to-ADF converter in `apps/web/src/lib/atlassian/` (paragraphs, headings, bold/italic/code, links, bullet and numbered lists, code blocks; anything else becomes plain text; no new dependency). PV owns the whole description of an adopted issue. A stored hash of the ADF Jira last returned (`sync_base`) tells whether Jira's description changed since the last sync. PV rewrites the description only when the PV text changed since the last sync; if Jira's text also changed, it is a conflict, shown as plain text (ADF flattened for display only, never written back) with Keep Product Velocity / Keep Jira.
4. **Conflicts.** Same three-way compare as GitHub (docs/21 section 8): `item_jira_links.sync_base` holds hashes only (title, description, labels). Only Jira changed: conflict with default Keep Product Velocity. Both changed: conflict, no default. Keep Jira pulls the text into PV (undoable, audited).

**Boundaries kept:** reading before writing; nothing written before confirmation; a stale issue stops the run as GitHub's does; outbound allowlist plus a test that fails if a commercial field reaches a Jira payload; no status, no transitions, Initiative Status never from or to Jira (rule 6); Claude can prepare but never confirm, service accounts and platform staff cannot confirm; 429 is retried with back-off, ReconnectNeeded means "sign in again" and is never retried; Jira text is data.

**Order of slices:** (A) allowlist, Markdown-to-ADF and the Jira client for writes with 429 back-off, all unit-tested against a fake Jira; (B) migration `sync_base`, apply function and the engine's `start` (compare, Received/Conflicts/To send); (C) `confirm` with Writing x/y, per-initiative result and Retry, registered in the router; (D) dialog, Help text, release fragment, axe test.

**Coordination:** the read half (refreshing linked initiatives from Jira) is built by another session; this work will rebase on its PR and share its `start` (Received lines) rather than duplicate it.
