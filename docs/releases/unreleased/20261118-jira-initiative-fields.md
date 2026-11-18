---
bump: minor
---
**Jira Initiative fields.** Under Settings, Integrations, Jira, Field mapping, a new "Initiative fields" card maps Health, Initiative Status and Initiative Phase to custom single-select fields on the Jira Initiative, with one Jira option per value. Product Velocity values go to Jira after the Sync preview. A Health or Initiative Status changed in Jira comes back as a suggestion in Sync with Jira that a person accepts (never silently); Initiative Phase only goes to Jira because it moves at the decision gates. Migration `jira_select_fields`. GitHub parity follows in a separate issue.
