---
date: 2026-11-27
by: Ashu (chat, 2026-11-27: "yes, fix this please"), written by Claude
request: 744
status: built, to confirm
---
**After a Jira disconnect and reconnect, the daily webhook maintenance clears the registration left over from before and registers the new one (issue 744).**

- **What happened (R89, project RR).** Jira was disconnected and reconnected to test Confluence. Jira allows one callback address per sign-in, and the old registration was still held, so every daily registration was refused ("Only a single URL per user is allowed to be registered via REST API. The currently used URL: ...") and the webhook stayed failed. Epic changes then arrived only at the daily check or on Sync. The held address pointed at the project link as it was before the reconnect (a link id that no longer exists), so it could never be delivered to or refreshed.
- **What the maintenance does now.** On that refusal it reads the held address from Jira's own answer, and only when it is our address with a well-formed token: its own link: adopt it (take its secret, find its id and expiry in Jira's list by the project filter); a link that exists nowhere in Product Velocity (an orphan of a reconnect): list the webhooks of this sign-in and remove them, then register again in the same run; a link that exists (another project or workspace): change nothing and say so; an address that is not ours: change nothing.
- **A narrow Jira DELETE.** `DELETE /webhook`, by ids from Jira's own list, in one function (`jiraWebhookRemover`, `server.ts`), imported by the daily maintenance only. It removes the webhook registrations of one sign-in, never an issue; the transition guard test now allows exactly this one quoted DELETE and keeps every other file free of one. It runs without a person pressing a button, like the daily registration itself; nothing is deleted unless the held address is provably an orphan of ours.
- **Also fixed.** A failed registration used to overwrite the stored secret of a registration that works (deliveries would then be refused as unknown); now only its state and reason change.
- **Not changed.** Webhooks stay a hint (the receiver re-reads the issue from Jira); the daily check and Sync still read everything. Registration remains one address per linked project; two projects linked through one Jira sign-in cannot both receive live updates (Jira's limit): the second is read at the daily check, and the message says so. A fix for that (one address per connection) is a separate decision.
