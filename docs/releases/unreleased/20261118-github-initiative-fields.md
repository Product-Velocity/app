---
bump: minor
---
**GitHub Initiative fields.** Under Settings, Integrations, GitHub, Field mapping, an "Initiative fields" card maps Health, Initiative Status and Initiative Phase to single-select fields of the project's board, with one board option per value, like the Jira card. Product Velocity values are written to the board after the Sync preview. A Health or Initiative Status changed on the board comes back as a suggestion in Sync with GitHub that a person accepts (never silently); Initiative Phase only goes to GitHub because it moves at the decision gates. Migration `github_select_fields`.
