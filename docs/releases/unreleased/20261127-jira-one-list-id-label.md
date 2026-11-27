---
bump: minor
type: improved
---
**One list on the Jira tab, the Initiative ID as the Jira label, the Product Manager as assignee and a phase label.** When Product Velocity owns an initiative, the Jira tab shows one list of epics and issues instead of two; epics made directly in Jira under the issue show in it too ("In Jira"). Jira issues carry the label `pm:item/R-102` (the Initiative ID) instead of a hash; the next Sync swaps the old label and keeps your own labels. A NEW Jira issue gets the Product Manager as its assignee (matched by email, set only at creation, never changed afterwards; left empty with a note when Jira has no single match). The Initiative Phase now goes to GitHub and Jira as a label such as `pm:phase/discover`, on by default and switchable per project in the field configuration (migration `phase_label_default_on`).
