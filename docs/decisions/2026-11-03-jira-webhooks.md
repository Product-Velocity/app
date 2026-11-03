---
date: 2026-11-03
by: Claude (decided within issue #257 / #67; Ashu asked for automated status updates, no manual sync; to confirm in the PR)
request: 257
---
**Jira webhooks for automated status updates (spike J3).** Ashu: "J3 is next, no manual sync but automated status updates." Built, but switched off until the sandbox spike has confirmed the facts below.

**Decision.** Webhooks first, the daily check as the backstop.
- One webhook per linked Jira project (events `jira:issue_created` and `jira:issue_updated`, JQL filter `project = KEY`), registered by the existing daily check `/api/cron/jira` (the free Vercel plan allows two cron jobs and both are used). The same run extends every webhook with fewer than 20 days left and registers it again if Jira no longer knows it. Table `jira_webhooks` (migration `jira_webhooks`, RLS and probe added) holds the Jira webhook id, expiry, state and counters.
- **A delivery is a hint, never data.** The receiver (`POST /api/jira/webhook/<link id>.<secret>`) takes only the issue key from the body, re-reads that issue from Jira and applies it through the same path as the daily check (`jira_apply_statuses`: compare before write, older answers ignored, Build Status from the status category, Initiative Status never). So duplicates, late and out-of-order deliveries and forged bodies cannot change anything Jira does not say. This is the dedupe and ordering answer: nothing needs to be tracked.
- **Credential.** As far as known, dynamic webhooks of OAuth 3LO apps are not signed, so the address carries a random secret (192 bits). Only its SHA-256 is stored; the check is constant time; a wrong secret, an unknown link or a switched-off feature answer 404. Bodies, keys and addresses are never logged.
- **Answers.** 200 for handled or ignorable (another event, an issue that is not linked, a connection that needs a new sign-in: retrying cannot help); 500 only when reading Jira failed, so Jira retries.
- **Scope.** `manage:jira-webhook` is asked for only when `JIRA_WEBHOOKS=1`. A connection made earlier lacks it: its webhooks show state `needs_scope` and nothing is retried until the admin signs in to Jira again (existing "reconnect" flow).
- **What is live and what is not.** The status of linked initiatives follows within seconds. The children tree (delivery progress) and the light records of unlinked issues are still refreshed by the daily check (a webhook per child event would be a tree read per event); making the tree event-driven is a follow-up once the spike shows real delivery rates.
- **Switch.** `JIRA_WEBHOOKS=1` and `JIRA_WEBHOOK_ORIGIN=https://<deployment>` (no path). Off by default.

**Unverified (documented behaviour, from memory; developer.atlassian.com is not reachable from the cloud session):** 30-day expiry and `PUT /webhook/refresh`; registration answer shape (`webhookRegistrationResult[].createdWebhookId`); limit of 100 webhooks per app and site; delivery retries (about 5, with back-off); no ordering guarantee; unsigned deliveries. The spike (`/spikes/atlassian`, "J3") registers, lists, refreshes, reads `GET /webhook/failed` and deletes one webhook and prints the real answers; the receiver `/api/spikes/jira-webhook` logs only event name, header names and size so Ashu can see a real delivery in the Vercel logs.
