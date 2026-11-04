---
issue: 319
status: done
logged: 2026-11-04
done: 2026-11-04
link: PR for issue 319
title: Jira Sync sends Summary, Hypothesis, Artifacts and file links in the description, like GitHub
---
Ashu (2026-11-04): Jira should get the same sections as the GitHub issue (Summary, Description, Hypothesis, Artifacts, Files); share the file links on Jira too; one-time switch for existing issues; Artifacts switchable per project. Built: `jira-sections.ts`, the compare of four texts, migration `20261104220831_jira_description_sections.sql`, field configuration slots, Help rows. Decision in `docs/decisions/2026-11-04-jira-description-sections.md`. Apply the migration after PR #318's migration (it replaces `tracker_set_field_config`).
