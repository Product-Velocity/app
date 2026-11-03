---
bump: minor
---
**Choose which Jira fields Sync fills, per project (issue #67 and #70).** Under Settings, Integrations, Jira, each linked project has a "Field mapping": the Jira field that holds the start date, and the Jira priority for each MoSCoW value (suggestions are marked, nothing is preselected). Sync with Jira then sends Planned Start and the priority for initiatives that Product Velocity owns; fields you leave unmapped are skipped and the preview says so. Saving the mapping writes nothing to Jira. Migration `20261103102116_jira_field_map.sql`.
