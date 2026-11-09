---
bump: minor
---
**Change Type now has a third value, Bug, and pulling in a GitHub issue keeps its `type:` and `area:` labels.** `type:feature`, `type:improvement` (or enhancement) and `type:bug` become the Change Type, and `area:<name>` becomes the Focus Area, once, when you click Pull in and only into fields that are still empty. Other labels and ambiguous ones (two different types or areas) are left out. A Bug initiative sends the label `pv:type/bug` to GitHub and Jira. Migrations `20261109112911_github_copy_issue_labels` and `20261109113103_change_type_bug`. Jira pull-in follows with issue #365.
