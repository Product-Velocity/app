---
bump: minor
---
**Link a project to a Jira project (issue #67, second part).** On Settings, Integrations, Jira an admin links each project to a Jira project of a connected site and confirms which of that Jira project's own issue types are an initiative, an epic and a task (proposed automatically). A project uses one tracker, so a GitHub project cannot be linked, and unlinking or disconnecting Jira releases the project. Nothing is read from or written to Jira yet. Migration `20261102223131_jira_project_links.sql` (table `jira_project_links`, functions `jira_link_project`, `jira_unlink_project`, and `jira_disconnect` now also releases linked projects). Link-style buttons no longer show an underline.
