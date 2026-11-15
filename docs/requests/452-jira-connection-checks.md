---
issue: 452
status: in progress
logged: 2026-11-15
title: Jira connection checks: Initiative-level checks and saved results on the Test connection page
---
Ashu (2026-11-15): "should we include these tests on the JIRA connection page going forward? why do I need to copy information back and forth?" Built: read-only checks and a confirmed write test with pass / warn / fail, saved in `jira_check_runs` and shown as the last run; the Initiative probes are removed from the spike page. Decision: `docs/decisions/2026-11-15-jira-connection-checks.md`. Not built: the daily-check slice (needs the Jira tab, #431) and the GitHub twin (issue #454). Set to `done` when the PR is merged and the optional slice is decided.
