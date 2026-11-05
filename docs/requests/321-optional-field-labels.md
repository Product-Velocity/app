---
issue: 321
status: done
logged: 2026-11-05
done: 2026-11-05
link: PR for issue 321
title: Optional labels for Tags, Focus Area and Roadmap Category on GitHub and Jira (off by default)
---
Ashu (2026-11-05): send Tags, Focus Area and Roadmap Category as optional labels on both trackers; Ready for Build and Agent-ready are dropped for now. Built: three default-off switches in the field configuration, migration `20261105150159_optional_field_labels.sql`, allowlists, Help. Decision in `docs/decisions/2026-11-05-optional-field-labels.md`. Apply the migration (it replaces `tracker_set_field_config`).
