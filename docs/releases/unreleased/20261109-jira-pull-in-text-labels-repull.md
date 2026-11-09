---
bump: minor
---
**Jira now matches GitHub when you pull issues in.** Pulling in a Jira issue keeps its description (converted to Markdown) as the Description, a `type:` label as Change Type (feature, improvement, bug) and an `area:` label as Focus Area, once and only into empty fields. The Pulled in tab of the Jira list has the same Re-pull button, which fills what is still empty and never replaces a value or writes to Jira. The Jira issue type is not mapped to Change Type. The pull-in message on the Jira tab no longer says GitHub. Migration `20261109191636_jira_copy_issue_fields`.
