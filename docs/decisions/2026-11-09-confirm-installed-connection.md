---
date: 2026-11-09
by: Ashu (instruction 2026-11-09), written by Claude
request: 364
status: built
---
**An admin can finish a GitHub connection without the App owner: Product Velocity now confirms an installation from GitHub's own answer, and the webhook is no longer the only thing that can do it.**

**What went wrong (EARO, account `dev-nbm`, 2026-11-09).** GitHub said connected, Product Velocity stayed at "Installed: waiting for GitHub to confirm" and Sync stayed off. The audit log showed the webhook had connected it and read the repositories, and then the install-return page wrote `installing` over it: the page read the row, waited for GitHub, and wrote a state worked out from the old row. Nothing sends the webhook again, and redelivering it needs the owner of the GitHub App, which a workspace admin is not.

**The rules**
- The install-return step saves the installation details without touching `state`, then moves a connection to `installing` only while it is still `requested` or `waiting_approval` (one conditional update). It can no longer overwrite `connected`.
- After it has read the installation from GitHub with the App's key (it exists, its account equals the one the admin entered, it is not suspended) the same step connects the connection. This replaces the rule "only GitHub's `installation` webhook sets connected" (`docs/04`, Connection steps 3). The evidence is the same kind: GitHub's own statement, signed with the App's key, plus the signed install state that ties the return to one admin, workspace and connection. The webhook stays, and runs the same idempotent code, in either order.
- **Confirm with GitHub** on the status card (workspace admins, not service accounts or platform staff) runs that same check for a connection that is installed but unconfirmed, for example a webhook that never arrived. It writes nothing to GitHub and returns no secret.
- Nothing else changes: an organisation owner still has to approve a request (`waiting_approval` has no installation yet), a different account is refused, suspension and deletion still come from the webhook.

**Parity.** Exception, with reason: Jira connects in one step through the OAuth callback (`completeConnection`) and has no waiting state, so there is no equivalent to build. Issue #364.
