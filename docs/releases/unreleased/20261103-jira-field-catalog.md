---
bump: minor
---
**Jira fields and field mapping.** For a linked Jira project, admins see every field of the Jira site (id, name, kind, how many recent issues fill it) under Settings, Integrations, Jira, and can map chosen Jira fields to Product Velocity fields, read only or two-way. Commercial fields, statuses, tracker-driven fields and mismatched kinds are refused with a reason; unmapped fields are ignored. Saving a mapping changes nothing in Jira or the roadmap yet. Migration `jira_field_mappings`.
