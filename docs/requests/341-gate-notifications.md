---
issue: 341
status: in progress
logged: 2026-11-05
title: Approver notifications: tell the people who can decide a gate, and tell the requester what was decided
---
Ashu (2026-11-05): build the approver notifications next (an open item of #323; the notification design was build-plan issue #104). Decision in `docs/decisions/2026-11-05-gate-notifications.md`; behaviour in `docs/28-DECISION-GATES.md` section 6a. Built: the `notifications` table with RLS, triggers on `gate_reviews`, the bell in the top bar, "Ask these people" in the request dialog. Not built: email and Slack (they need an opt-in and an explicit confirmation), notifications for other events. Set to `done` when the PR is merged.
