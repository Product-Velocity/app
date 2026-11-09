---
date: 2026-11-09
by: Ashu (instruction 2026-11-09), written by Claude
request: 365
status: built
---
**The Jira issue type (Bug, Story, Task, Epic, ...) is not mapped to Change Type.** Only a `type:<x>` label sets Change Type, on GitHub and on Jira, by the same rules (`labelFields`). Reason: an issue type says what kind of ticket it is in Jira's hierarchy, not what kind of change the initiative is, so mapping it would guess (a Story is not always a New feature); GitHub's issue type is not mapped either. This closes the open question in issue #365. Built in issue #365 with the Jira pull-in text and labels (`docs/16-ATLASSIAN.md`).
