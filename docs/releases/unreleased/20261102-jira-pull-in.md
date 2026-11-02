---
bump: minor
---
**Pull Jira issues into the roadmap (issue #67, fourth part).** On Settings, Integrations, Jira, the open issues read from a linked Jira project are listed. Creators and admins select issues and pull them in as initiatives, read only or owned by Product Velocity, or ignore them (and bring them back later). Build Status follows the Jira status category and stays read only. Nothing is written to Jira. A project with initiatives linked to Jira issues cannot be unlinked until they are removed. Migration `20261102230917_jira_pull_in.sql` (table `item_jira_links`, functions `jira_pull_in`, `jira_set_state`, `item_set_jira_link_mode`; `jira_unlink_project` and `jira_disconnect` replaced).
