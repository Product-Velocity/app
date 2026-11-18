---
bump: minor
---
**Unlink a Jira project that has linked initiatives.** Settings, Integrations, Jira, Projects: set the project to "Not linked" and press Unlink. A confirmation asks whether to keep the initiatives (recommended; Build Status and delivery counts are cleared, Jira is not changed) or move them to the Trash. If you link the project again and pull the issues in, each issue is re-linked to its initiative by the marker label, with no duplicates. Migration `jira_unlink_release`.
