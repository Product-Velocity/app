---
issue: 744
status: done
logged: 2026-11-27
done: 2026-11-27
link: PR for issue 744
title: Jira webhooks: a reconnect leaves a stale registration that blocks the new one
---
From Ashu (2026-11-27): the webhook of project RR was failed after the audit; he had disconnected and reconnected Jira to test Confluence. Fixed per `docs/decisions/2026-11-27-jira-webhook-after-reconnect.md`; the next daily run clears the old registration and registers the new one.
