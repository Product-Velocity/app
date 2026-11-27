---
issue: 740
status: done
logged: 2026-11-27
done: 2026-11-27
link: PR for issue 740
title: Jira inbox: an issue Product Velocity created must not be offered as new
---
From Ashu (2026-11-27): after syncing R-102 to RR-7, the inbox offered RR-7 as a new Jira issue to pull in. Fixed per `docs/decisions/2026-11-27-pv-created-issues-are-pulled.md` (migration `jira_pv_issues_are_pulled`, applied to production). Open from the same message: the assignee was not set on RR-7 (created before the feature, by design) and the issue number cannot be forced from Product Velocity (Jira numbers its own issues); both answered in chat.
